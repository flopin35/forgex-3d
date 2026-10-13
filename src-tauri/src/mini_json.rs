//! A small JSON reader and writer for the MCP relay. It keeps numbers as their original
//! text, so tool arguments pass through to the app exactly as the AI sent them. Uses only
//! the standard library, so the relay can be compiled and tested on its own.

use std::fmt::Write as _;

#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    /// The number exactly as written.
    Number(String),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl Json {
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(fields) => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn str(value: &str) -> Json {
        Json::String(value.to_string())
    }

    pub fn object(fields: Vec<(&str, Json)>) -> Json {
        Json::Object(fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }

    pub fn to_json(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut String) {
        match self {
            Json::Null => out.push_str("null"),
            Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Json::Number(n) => out.push_str(n),
            Json::String(s) => write_string(s, out),
            Json::Array(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    item.write(out);
                }
                out.push(']');
            }
            Json::Object(fields) => {
                out.push('{');
                for (i, (key, value)) in fields.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write_string(key, out);
                    out.push(':');
                    value.write(out);
                }
                out.push('}');
            }
        }
    }
}

fn write_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

pub fn parse(text: &str) -> Result<Json, String> {
    let mut parser = Parser { bytes: text.as_bytes(), pos: 0, depth: 0 };
    parser.skip_ws();
    let value = parser.value()?;
    parser.skip_ws();
    if parser.pos != parser.bytes.len() {
        return Err(format!("unexpected text at {}", parser.pos));
    }
    Ok(value)
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
    depth: usize,
}

const MAX_DEPTH: usize = 256;

impl<'a> Parser<'a> {
    fn skip_ws(&mut self) {
        while let Some(&b) = self.bytes.get(self.pos) {
            if b == b' ' || b == b'\n' || b == b'\r' || b == b'\t' {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn expect(&mut self, word: &str) -> Result<(), String> {
        if self.bytes[self.pos..].starts_with(word.as_bytes()) {
            self.pos += word.len();
            Ok(())
        } else {
            Err(format!("expected {word} at {}", self.pos))
        }
    }

    fn value(&mut self) -> Result<Json, String> {
        match self.peek() {
            Some(b'n') => self.expect("null").map(|_| Json::Null),
            Some(b't') => self.expect("true").map(|_| Json::Bool(true)),
            Some(b'f') => self.expect("false").map(|_| Json::Bool(false)),
            Some(b'"') => self.string().map(Json::String),
            Some(b'[') => self.array(),
            Some(b'{') => self.object(),
            Some(b'-') | Some(b'0'..=b'9') => self.number(),
            _ => Err(format!("unexpected character at {}", self.pos)),
        }
    }

    fn nested(&mut self) -> Result<(), String> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            Err("JSON is nested too deeply".to_string())
        } else {
            Ok(())
        }
    }

    fn array(&mut self) -> Result<Json, String> {
        self.nested()?;
        self.pos += 1;
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            self.depth -= 1;
            return Ok(Json::Array(items));
        }
        loop {
            self.skip_ws();
            items.push(self.value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    self.depth -= 1;
                    return Ok(Json::Array(items));
                }
                _ => return Err(format!("expected , or ] at {}", self.pos)),
            }
        }
    }

    fn object(&mut self) -> Result<Json, String> {
        self.nested()?;
        self.pos += 1;
        let mut fields = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            self.depth -= 1;
            return Ok(Json::Object(fields));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err(format!("expected a key at {}", self.pos));
            }
            let key = self.string()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err(format!("expected : at {}", self.pos));
            }
            self.pos += 1;
            self.skip_ws();
            let value = self.value()?;
            fields.push((key, value));
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    self.depth -= 1;
                    return Ok(Json::Object(fields));
                }
                _ => return Err(format!("expected , or }} at {}", self.pos)),
            }
        }
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        let digits = |p: &mut Parser| {
            let s = p.pos;
            while matches!(p.peek(), Some(b'0'..=b'9')) {
                p.pos += 1;
            }
            p.pos > s
        };
        if !digits(self) {
            return Err(format!("bad number at {start}"));
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if !digits(self) {
                return Err(format!("bad number at {start}"));
            }
        }
        if matches!(self.peek(), Some(b'e') | Some(b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+') | Some(b'-')) {
                self.pos += 1;
            }
            if !digits(self) {
                return Err(format!("bad number at {start}"));
            }
        }
        Ok(Json::Number(String::from_utf8_lossy(&self.bytes[start..self.pos]).to_string()))
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let end = self.pos + 4;
        let text = self.bytes.get(self.pos..end).ok_or("short \\u escape")?;
        let value = u32::from_str_radix(std::str::from_utf8(text).map_err(|_| "bad \\u escape")?, 16).map_err(|_| "bad \\u escape")?;
        self.pos = end;
        Ok(value)
    }

    fn string(&mut self) -> Result<String, String> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let start = self.pos;
            while let Some(b) = self.peek() {
                if b == b'"' || b == b'\\' || b < 0x20 {
                    break;
                }
                self.pos += 1;
            }
            out.push_str(std::str::from_utf8(&self.bytes[start..self.pos]).map_err(|_| "invalid UTF-8")?);
            match self.peek() {
                Some(b'"') => {
                    self.pos += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.pos += 1;
                    let escape = self.peek().ok_or("unfinished escape")?;
                    self.pos += 1;
                    match escape {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let first = self.hex4()?;
                            let code = if (0xd800..0xdc00).contains(&first) && self.bytes[self.pos..].starts_with(b"\\u") {
                                self.pos += 2;
                                let second = self.hex4()?;
                                0x10000 + ((first - 0xd800) << 10) + (second.wrapping_sub(0xdc00) & 0x3ff)
                            } else {
                                first
                            };
                            out.push(char::from_u32(code).unwrap_or('\u{fffd}'));
                        }
                        _ => return Err("bad escape".to_string()),
                    }
                }
                _ => return Err("unfinished string".to_string()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_values_and_keeps_numbers_exact() {
        let text = r#"{"a":[1,2.50,-3e2,true,null],"b":"x\"y\\né😀","c":{}}"#;
        let value = parse(text).unwrap();
        assert_eq!(value.get("a").unwrap(), &Json::Array(vec![Json::Number("1".into()), Json::Number("2.50".into()), Json::Number("-3e2".into()), Json::Bool(true), Json::Null]));
        assert_eq!(value.get("b").unwrap().as_str().unwrap(), "x\"y\\né😀");
        assert_eq!(parse(&value.to_json()).unwrap(), value);
    }

    #[test]
    fn rejects_broken_json() {
        assert!(parse("{").is_err());
        assert!(parse("[1,]").is_err());
        assert!(parse("{\"a\" 1}").is_err());
        assert!(parse("1 2").is_err());
        assert!(parse(&"[".repeat(400)).is_err());
    }
}
