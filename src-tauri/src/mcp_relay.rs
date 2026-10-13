//! The FORGEX MCP server built into the app: run `FORGEX 3D.exe --mcp` from an MCP client
//! (Claude Desktop, Claude Code, VS Code...). Nothing else needs installing.
//!
//! It speaks MCP over stdin and stdout and passes every tool call to the open FORGEX 3D
//! window through the same local link the Node server uses: it listens on 127.0.0.1 port
//! 47833, the app asks it for the next call (GET /forgex/v1/poll) and posts the result
//! (POST /forgex/v1/result). The tools themselves run in the app, in its undo history, so
//! the user watches the work happen. When FORGEX 3D is not open, the relay opens it.
//!
//! Standard library only (plus mini_json), so it is unit-tested with plain rustc too.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::mini_json::{parse, Json};

pub const DEFAULT_PORT: u16 = 47833;
const BRIDGE_PATH: &str = "/forgex/v1";
const POLL_HOLD: Duration = Duration::from_secs(25);
const RECENTLY_SEEN: Duration = Duration::from_secs(5);
const MAX_BODY_BYTES: usize = 40 * 1024 * 1024;
const ALLOWED_ORIGINS: [&str; 5] = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://localhost:1420", "http://127.0.0.1:1420"];
const SUPPORTED_PROTOCOLS: [&str; 4] = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const LATEST_PROTOCOL: &str = "2025-11-25";
/// Tools that can wait on the user (an unsaved-changes prompt or a save dialog).
const DIALOG_TOOLS: [&str; 3] = ["new_project", "open_project", "save_project"];

/// The tool list and instructions, exported from the app's own tool definitions
/// (src/core/automation) and checked by a unit test there, so they cannot drift apart.
pub const TOOLS_JSON: &str = include_str!("../mcp-tools.json");

pub struct RelayConfig {
    pub port: u16,
    pub version: String,
    /// Opens FORGEX 3D when it is not running. None in tests.
    pub launch_app: Option<Box<dyn Fn() -> Result<(), String> + Send + Sync>>,
    /// How long to wait for an already open app to link before opening one.
    pub wait_for_open_app: Duration,
    /// How long to wait for a newly opened app to link.
    pub wait_for_launch: Duration,
    pub tools_json: &'static str,
}

impl RelayConfig {
    pub fn standard(version: &str, launch_app: Option<Box<dyn Fn() -> Result<(), String> + Send + Sync>>) -> RelayConfig {
        RelayConfig {
            port: DEFAULT_PORT,
            version: version.to_string(),
            launch_app,
            wait_for_open_app: Duration::from_secs(5),
            wait_for_launch: Duration::from_secs(40),
            tools_json: TOOLS_JSON,
        }
    }
}

fn log(message: &str) {
    // stdout carries protocol messages only; notes go to stderr (Claude keeps them in its logs).
    let _ = writeln!(std::io::stderr(), "[forgex-mcp] {message}");
}

// -- The link to the app ------------------------------------------------------------------

struct Job {
    id: String,
    tool: String,
    args: Json,
}

#[derive(Default)]
struct LinkState {
    queue: VecDeque<Job>,
    results: HashMap<String, Json>,
    /// Bumped by every poll; an older poll that sees a newer number steps aside.
    poll_generation: u64,
    active_polls: usize,
    last_seen: Option<Instant>,
    /// Jobs handed to the app and not answered yet.
    delivered: usize,
}

pub struct AppLink {
    state: Mutex<LinkState>,
    changed: Condvar,
    counter: AtomicU64,
}

impl AppLink {
    fn new() -> AppLink {
        AppLink { state: Mutex::new(LinkState::default()), changed: Condvar::new(), counter: AtomicU64::new(1) }
    }

    /// True while the app is polling, working on a call, or was seen in the last few seconds.
    pub fn connected(&self) -> bool {
        let state = self.state.lock().unwrap();
        state.active_polls > 0 || state.delivered > 0 || state.last_seen.map(|t| t.elapsed() < RECENTLY_SEEN).unwrap_or(false)
    }

    fn wait_connected(&self, limit: Duration) -> bool {
        let deadline = Instant::now() + limit;
        loop {
            if self.connected() {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            let state = self.state.lock().unwrap();
            let _ = self.changed.wait_timeout(state, Duration::from_millis(200)).unwrap();
        }
    }

    fn next_id(&self) -> String {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        format!("{:x}-{:x}-{:x}", std::process::id(), nanos, self.counter.fetch_add(1, Ordering::Relaxed))
    }

    /// Sends a tool call to the app and waits for its answer: Ok(output) or Err(message).
    pub fn call(&self, tool: &str, args: Json, timeout: Duration) -> Result<Json, String> {
        let id = self.next_id();
        let deadline = Instant::now() + timeout;
        let mut state = self.state.lock().unwrap();
        state.queue.push_back(Job { id: id.clone(), tool: tool.to_string(), args });
        self.changed.notify_all();
        loop {
            if let Some(result) = state.results.remove(&id) {
                state.delivered = state.delivered.saturating_sub(1);
                self.changed.notify_all();
                let ok = result.get("ok").and_then(Json::as_bool).unwrap_or(false);
                return match (ok, result.get("output")) {
                    (true, Some(output)) => Ok(output.clone()),
                    _ => Err(result.get("error").and_then(Json::as_str).unwrap_or("FORGEX 3D reported an unknown error.").to_string()),
                };
            }
            let now = Instant::now();
            if now >= deadline {
                let before = state.queue.len();
                state.queue.retain(|job| job.id != id);
                if state.queue.len() == before {
                    // It was handed over but never answered.
                    state.delivered = state.delivered.saturating_sub(1);
                }
                return Err("FORGEX 3D did not answer in time. Check that the app is still open.".to_string());
            }
            state = self.changed.wait_timeout(state, deadline - now).unwrap().0;
        }
    }

    /// One long poll from the app: the next job, or None after the hold time (or when a newer poll takes over).
    fn poll(&self) -> Option<Job> {
        let mut state = self.state.lock().unwrap();
        state.poll_generation += 1;
        let generation = state.poll_generation;
        state.active_polls += 1;
        state.last_seen = Some(Instant::now());
        self.changed.notify_all();
        let deadline = Instant::now() + POLL_HOLD;
        let job = loop {
            if state.poll_generation != generation {
                break None;
            }
            if let Some(job) = state.queue.pop_front() {
                state.delivered += 1;
                break Some(job);
            }
            let now = Instant::now();
            if now >= deadline {
                break None;
            }
            state = self.changed.wait_timeout(state, deadline - now).unwrap().0;
        };
        state.active_polls -= 1;
        state.last_seen = Some(Instant::now());
        self.changed.notify_all();
        job
    }

    /// Puts a job back when it could not be handed to the app (the poll connection closed).
    fn requeue(&self, job: Job) {
        let mut state = self.state.lock().unwrap();
        state.delivered = state.delivered.saturating_sub(1);
        state.queue.push_front(job);
        self.changed.notify_all();
    }

    fn deliver_result(&self, body: Json) -> bool {
        let Some(id) = body.get("id").and_then(Json::as_str).map(str::to_string) else { return false };
        let mut state = self.state.lock().unwrap();
        state.last_seen = Some(Instant::now());
        state.results.insert(id, body);
        self.changed.notify_all();
        true
    }
}

// -- The local HTTP server the app polls ------------------------------------------------------

struct Request {
    method: String,
    path: String,
    origin: Option<String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let path = target.split('?').next().unwrap_or("/").to_string();
    let mut origin = None;
    let mut length = 0usize;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).ok()? == 0 {
            return None;
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            let value = value.trim();
            match name.trim().to_ascii_lowercase().as_str() {
                "origin" => origin = Some(value.to_string()),
                "content-length" => length = value.parse().ok()?,
                _ => {}
            }
        }
    }
    if length > MAX_BODY_BYTES {
        return None;
    }
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).ok()?;
    Some(Request { method, path, origin, body })
}

fn respond(stream: &mut TcpStream, status: &str, origin: Option<&str>, body: Option<&str>) -> bool {
    let mut head = format!("HTTP/1.1 {status}\r\nCache-Control: no-store\r\nConnection: close\r\n");
    if let Some(origin) = origin {
        head.push_str(&format!(
            "Access-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n"
        ));
    }
    match body {
        Some(body) => head.push_str(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len())),
        None => head.push_str("Content-Length: 0\r\n\r\n"),
    }
    stream.write_all(head.as_bytes()).and_then(|_| stream.flush()).is_ok()
}

fn handle_connection(mut stream: TcpStream, link: Arc<AppLink>, version: String) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let Some(request) = read_request(&mut stream) else {
        respond(&mut stream, "400 Bad Request", None, None);
        return;
    };
    let origin = request.origin.as_deref();
    if let Some(origin) = origin {
        if !ALLOWED_ORIGINS.contains(&origin) {
            respond(&mut stream, "403 Forbidden", None, None);
            return;
        }
    }
    let path = request.path.as_str();
    match (request.method.as_str(), path.strip_prefix(BRIDGE_PATH)) {
        ("OPTIONS", _) => {
            respond(&mut stream, "204 No Content", origin, None);
        }
        ("GET", Some("/hello")) => {
            let body = Json::object(vec![("name", Json::str("forgex-3d-relay")), ("version", Json::str(&version))]).to_json();
            respond(&mut stream, "200 OK", origin, Some(&body));
        }
        ("GET", Some("/poll")) => match link.poll() {
            Some(job) => {
                let body = Json::object(vec![("id", Json::str(&job.id)), ("tool", Json::str(&job.tool)), ("args", job.args.clone())]).to_json();
                if !respond(&mut stream, "200 OK", origin, Some(&body)) {
                    link.requeue(job);
                }
            }
            None => {
                respond(&mut stream, "204 No Content", origin, None);
            }
        },
        ("POST", Some("/result")) => {
            let parsed = std::str::from_utf8(&request.body).ok().and_then(|text| parse(text).ok());
            let status = match parsed {
                Some(body) => {
                    if link.deliver_result(body) {
                        "204 No Content"
                    } else {
                        "404 Not Found"
                    }
                }
                None => "400 Bad Request",
            };
            respond(&mut stream, status, origin, None);
        }
        _ => {
            respond(&mut stream, "404 Not Found", origin, None);
        }
    }
}

/// Starts the local server the app polls. Err when the port is taken.
pub fn start_link(port: u16, version: &str) -> Result<(Arc<AppLink>, u16), String> {
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("port {port} is in use ({e})"))?;
    let bound = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    let link = Arc::new(AppLink::new());
    let shared = link.clone();
    let version = version.to_string();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let link = shared.clone();
            let version = version.clone();
            thread::spawn(move || handle_connection(stream, link, version));
        }
    });
    Ok((link, bound))
}

// -- MCP over stdin and stdout ---------------------------------------------------------------

type Output = Arc<Mutex<Box<dyn Write + Send>>>;

fn send(output: &Output, message: &Json) -> bool {
    let mut out = output.lock().unwrap();
    out.write_all(message.to_json().as_bytes()).and_then(|_| out.write_all(b"\n")).and_then(|_| out.flush()).is_ok()
}

fn reply(id: &Json, result: Json) -> Json {
    Json::object(vec![("jsonrpc", Json::str("2.0")), ("id", id.clone()), ("result", result)])
}

fn error_reply(id: &Json, code: i64, message: &str) -> Json {
    Json::object(vec![
        ("jsonrpc", Json::str("2.0")),
        ("id", id.clone()),
        ("error", Json::object(vec![("code", Json::Number(code.to_string())), ("message", Json::str(message))])),
    ])
}

fn tool_text(text: &str, is_error: bool) -> Json {
    let content = Json::Array(vec![Json::object(vec![("type", Json::str("text")), ("text", Json::str(text))])]);
    if is_error {
        Json::object(vec![("content", content), ("isError", Json::Bool(true))])
    } else {
        Json::object(vec![("content", content)])
    }
}

/// The app's tool output ({ text, image? }) as MCP content.
fn tool_output(output: &Json) -> Json {
    let mut content = vec![Json::object(vec![("type", Json::str("text")), ("text", Json::str(output.get("text").and_then(Json::as_str).unwrap_or("")))])];
    if let Some(image) = output.get("image") {
        if let (Some(data), Some(mime)) = (image.get("data").and_then(Json::as_str), image.get("mimeType").and_then(Json::as_str)) {
            content.push(Json::object(vec![("type", Json::str("image")), ("data", Json::str(data)), ("mimeType", Json::str(mime))]));
        }
    }
    Json::object(vec![("content", Json::Array(content))])
}

fn negotiate(requested: Option<&str>) -> String {
    match requested {
        Some(v) if SUPPORTED_PROTOCOLS.contains(&v) => v.to_string(),
        // Newer dated revisions keep these basic tool messages, so accept them.
        Some(v) if v.len() == 10 && v.as_bytes()[4] == b'-' && v > LATEST_PROTOCOL => v.to_string(),
        _ => LATEST_PROTOCOL.to_string(),
    }
}

struct Relay {
    config: RelayConfig,
    link: Option<Arc<AppLink>>,
    link_problem: Option<String>,
    tools: Json,
    instructions: Json,
    tool_names: Vec<String>,
    launch_lock: Mutex<Option<Instant>>,
}

impl Relay {
    /// Makes sure the app is linked, opening it when needed. Err explains what to do.
    fn ensure_app(&self) -> Result<Arc<AppLink>, String> {
        let link = match &self.link {
            Some(link) => link.clone(),
            None => {
                return Err(format!(
                    "FORGEX could not open its local link ({}). Another FORGEX MCP server is probably running for a different AI app; close that app or remove the older server from its settings, then try again.",
                    self.link_problem.clone().unwrap_or_default()
                ))
            }
        };
        if link.connected() || link.wait_connected(self.config.wait_for_open_app) {
            return Ok(link);
        }
        let launched = {
            let mut last = self.launch_lock.lock().unwrap();
            let recently = last.map(|t| t.elapsed() < self.config.wait_for_launch).unwrap_or(false);
            match (&self.config.launch_app, recently) {
                (Some(launch), false) => {
                    *last = Some(Instant::now());
                    launch().map(|_| true)
                }
                (Some(_), true) => Ok(true),
                (None, _) => Ok(false),
            }
        };
        match launched {
            Ok(true) => {
                if link.wait_connected(self.config.wait_for_launch) {
                    Ok(link)
                } else {
                    Err("FORGEX 3D was opened but did not link in time. Check that its window is open, then try again.".to_string())
                }
            }
            Ok(false) => Err("FORGEX 3D is not open. Open it and it links to this assistant automatically.".to_string()),
            Err(problem) => Err(format!("FORGEX 3D could not be opened: {problem}")),
        }
    }

    fn call_tool(&self, params: Option<&Json>) -> Result<Json, (i64, String)> {
        let name = params.and_then(|p| p.get("name")).and_then(Json::as_str).unwrap_or("").to_string();
        if !self.tool_names.iter().any(|t| t == &name) {
            return Err((-32602, format!("Unknown tool: {name}")));
        }
        let args = params.and_then(|p| p.get("arguments")).cloned().unwrap_or(Json::Object(Vec::new()));
        let link = match self.ensure_app() {
            Ok(link) => link,
            Err(message) => return Ok(tool_text(&message, true)),
        };
        let timeout = if DIALOG_TOOLS.contains(&name.as_str()) {
            Duration::from_secs(600)
        } else if name == "capture_viewport" {
            Duration::from_secs(60)
        } else {
            Duration::from_secs(30)
        };
        Ok(match link.call(&name, args, timeout) {
            Ok(output) => tool_output(&output),
            Err(message) => tool_text(&message, true),
        })
    }

    /// Answers one message. None for notifications.
    fn handle(&self, message: &Json) -> Option<Json> {
        let null = Json::Null;
        let id = message.get("id");
        let method = message.get("method").and_then(Json::as_str)?;
        let id_or_null = id.unwrap_or(&null);
        match method {
            "initialize" => {
                let requested = message.get("params").and_then(|p| p.get("protocolVersion")).and_then(Json::as_str);
                Some(reply(
                    id_or_null,
                    Json::object(vec![
                        ("protocolVersion", Json::str(&negotiate(requested))),
                        ("capabilities", Json::object(vec![("tools", Json::object(vec![("listChanged", Json::Bool(false))]))])),
                        ("serverInfo", Json::object(vec![("name", Json::str("forgex-3d")), ("title", Json::str("FORGEX 3D")), ("version", Json::str(&self.config.version))])),
                        ("instructions", self.instructions.clone()),
                    ]),
                ))
            }
            "ping" => id.map(|id| reply(id, Json::Object(Vec::new()))),
            "tools/list" => Some(reply(id_or_null, Json::object(vec![("tools", self.tools.clone())]))),
            "tools/call" => Some(match self.call_tool(message.get("params")) {
                Ok(result) => reply(id_or_null, result),
                Err((code, text)) => error_reply(id_or_null, code, &text),
            }),
            _ if method.starts_with("notifications/") || id.is_none() => None,
            _ => Some(error_reply(id_or_null, -32601, &format!("Method not found: {method}"))),
        }
    }
}

/// Runs the relay until stdin closes. Returns the process exit code.
pub fn serve(input: impl BufRead, output: Box<dyn Write + Send>, config: RelayConfig) -> i32 {
    let output: Output = Arc::new(Mutex::new(output));
    let catalog = match parse(config.tools_json) {
        Ok(json) => json,
        Err(problem) => {
            log(&format!("The built-in tool list is damaged: {problem}"));
            return 1;
        }
    };
    let tools = catalog.get("tools").cloned().unwrap_or(Json::Array(Vec::new()));
    let tool_names = match &tools {
        Json::Array(items) => items.iter().filter_map(|t| t.get("name").and_then(Json::as_str).map(str::to_string)).collect(),
        _ => Vec::new(),
    };
    let (link, link_problem) = match start_link(config.port, &config.version) {
        Ok((link, port)) => {
            log(&format!("Waiting for the FORGEX 3D app on 127.0.0.1:{port}."));
            (Some(link), None)
        }
        Err(problem) => {
            log(&format!("App link unavailable: {problem}"));
            (None, Some(problem))
        }
    };
    let relay = Arc::new(Relay {
        instructions: catalog.get("instructions").cloned().unwrap_or(Json::str("")),
        tools,
        tool_names,
        link,
        link_problem,
        config,
        launch_lock: Mutex::new(None),
    });

    for line in input.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let message = match parse(&line) {
            Ok(message) => message,
            Err(_) => {
                send(&output, &error_reply(&Json::Null, -32700, "Parse error: each line must be one JSON message."));
                continue;
            }
        };
        if message.get("jsonrpc").and_then(Json::as_str) != Some("2.0") {
            send(&output, &error_reply(&Json::Null, -32600, "Invalid request: expected a JSON-RPC 2.0 message."));
            continue;
        }
        // Tool calls can wait on the app, so they run on their own thread; pings keep flowing meanwhile.
        if message.get("method").and_then(Json::as_str) == Some("tools/call") {
            let relay = relay.clone();
            let output = output.clone();
            thread::spawn(move || {
                if let Some(answer) = relay.handle(&message) {
                    send(&output, &answer);
                }
            });
        } else if let Some(answer) = relay.handle(&message) {
            if !send(&output, &answer) {
                break;
            }
        }
    }
    log("The AI app closed the connection.");
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    const TEST_TOOLS: &str = r#"{"instructions":"Test.","tools":[{"name":"get_status","title":"Status","description":"Shows the status of things.","inputSchema":{"type":"object"}},{"name":"capture_viewport","title":"Capture","description":"Takes a picture of the view.","inputSchema":{"type":"object"}}]}"#;

    struct ChannelWriter(mpsc::Sender<String>, Vec<u8>);
    impl Write for ChannelWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.1.extend_from_slice(buf);
            while let Some(pos) = self.1.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = self.1.drain(..=pos).collect();
                let _ = self.0.send(String::from_utf8_lossy(&line).trim().to_string());
            }
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    struct ChannelReader(mpsc::Receiver<String>, Vec<u8>);
    impl Read for ChannelReader {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.1.is_empty() {
                match self.0.recv() {
                    Ok(line) => self.1 = format!("{line}\n").into_bytes(),
                    Err(_) => return Ok(0),
                }
            }
            let n = buf.len().min(self.1.len());
            buf[..n].copy_from_slice(&self.1[..n]);
            self.1.drain(..n);
            Ok(n)
        }
    }

    fn http(port: u16, request: &str) -> String {
        // The relay starts on another thread; give it a moment to open its port.
        let mut tries = 0;
        let mut stream = loop {
            match TcpStream::connect(("127.0.0.1", port)) {
                Ok(stream) => break stream,
                Err(error) if tries < 50 => {
                    tries += 1;
                    let _ = error;
                    thread::sleep(Duration::from_millis(40));
                }
                Err(error) => panic!("relay port never opened: {error}"),
            }
        };
        stream.write_all(request.as_bytes()).unwrap();
        let mut out = String::new();
        let _ = stream.read_to_string(&mut out);
        out
    }

    fn free_port() -> u16 {
        TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port()
    }

    fn relay(port: u16, launch: Option<Box<dyn Fn() -> Result<(), String> + Send + Sync>>) -> (mpsc::Sender<String>, mpsc::Receiver<String>) {
        let (to_relay, relay_in) = mpsc::channel::<String>();
        let (relay_out, from_relay) = mpsc::channel::<String>();
        let config = RelayConfig {
            port,
            version: "9.9.9".to_string(),
            launch_app: launch,
            wait_for_open_app: Duration::from_millis(300),
            wait_for_launch: Duration::from_secs(3),
            tools_json: TEST_TOOLS,
        };
        thread::spawn(move || serve(BufReader::new(ChannelReader(relay_in, Vec::new())), Box::new(ChannelWriter(relay_out, Vec::new())), config));
        (to_relay, from_relay)
    }

    /// Plays the app: polls once, answers the job with `answer`.
    fn fake_app_once(port: u16, answer: impl Fn(&Json) -> String + Send + 'static) -> thread::JoinHandle<()> {
        thread::spawn(move || loop {
            let response = http(port, "GET /forgex/v1/poll HTTP/1.1\r\nHost: x\r\nOrigin: http://tauri.localhost\r\n\r\n");
            if !response.starts_with("HTTP/1.1 200") {
                continue;
            }
            assert!(response.contains("Access-Control-Allow-Origin: http://tauri.localhost"));
            let body = &response[response.find("\r\n\r\n").unwrap() + 4..];
            let job = parse(body).unwrap();
            let result = answer(&job);
            let post = format!("POST /forgex/v1/result HTTP/1.1\r\nHost: x\r\nOrigin: http://tauri.localhost\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{result}", result.len());
            assert!(http(port, &post).starts_with("HTTP/1.1 204"));
            return;
        })
    }

    fn recv(from: &mpsc::Receiver<String>) -> Json {
        parse(&from.recv_timeout(Duration::from_secs(10)).expect("relay answered")).unwrap()
    }

    #[test]
    fn answers_initialize_and_lists_tools() {
        let port = free_port();
        let (to, from) = relay(port, None);
        to.send(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#.into()).unwrap();
        let init = recv(&from);
        let result = init.get("result").unwrap();
        assert_eq!(result.get("protocolVersion").unwrap().as_str(), Some("2025-06-18"));
        assert_eq!(result.get("serverInfo").unwrap().get("version").unwrap().as_str(), Some("9.9.9"));
        to.send(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#.into()).unwrap();
        to.send(r#"{"jsonrpc":"2.0","id":"a","method":"tools/list"}"#.into()).unwrap();
        let list = recv(&from);
        assert_eq!(list.get("id").unwrap().as_str(), Some("a"));
        match list.get("result").unwrap().get("tools").unwrap() {
            Json::Array(tools) => assert_eq!(tools.len(), 2),
            other => panic!("tools was {other:?}"),
        }
        to.send(r#"{"jsonrpc":"2.0","id":2,"method":"nope"}"#.into()).unwrap();
        assert!(recv(&from).get("error").is_some());
        to.send("not json".into()).unwrap();
        assert_eq!(recv(&from).get("error").unwrap().get("code").unwrap(), &Json::Number("-32700".into()));
    }

    #[test]
    fn passes_tool_calls_to_the_app_and_back() {
        let port = free_port();
        let (to, from) = relay(port, None);
        let app = fake_app_once(port, |job| {
            assert_eq!(job.get("tool").unwrap().as_str(), Some("capture_viewport"));
            assert_eq!(job.get("args").unwrap().get("width").unwrap(), &Json::Number("640".into()));
            format!(r#"{{"id":"{}","ok":true,"output":{{"text":"Here it is.","image":{{"data":"QUJD","mimeType":"image/jpeg"}}}}}}"#, job.get("id").unwrap().as_str().unwrap())
        });
        to.send(r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"capture_viewport","arguments":{"width":640}}}"#.into()).unwrap();
        let answer = recv(&from);
        app.join().unwrap();
        let content = answer.get("result").unwrap().get("content").unwrap();
        match content {
            Json::Array(items) => {
                assert_eq!(items[0].get("text").unwrap().as_str(), Some("Here it is."));
                assert_eq!(items[1].get("mimeType").unwrap().as_str(), Some("image/jpeg"));
            }
            other => panic!("content was {other:?}"),
        }
    }

    #[test]
    fn reports_app_errors_and_unknown_tools() {
        let port = free_port();
        let (to, from) = relay(port, None);
        let app = fake_app_once(port, |job| format!(r#"{{"id":"{}","ok":false,"error":"Body is locked."}}"#, job.get("id").unwrap().as_str().unwrap()));
        to.send(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_status"}}"#.into()).unwrap();
        let answer = recv(&from);
        app.join().unwrap();
        let result = answer.get("result").unwrap();
        assert_eq!(result.get("isError"), Some(&Json::Bool(true)));
        assert!(result.to_json().contains("Body is locked."));
        to.send(r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"format_disk"}}"#.into()).unwrap();
        assert_eq!(recv(&from).get("error").unwrap().get("code").unwrap(), &Json::Number("-32602".into()));
    }

    #[test]
    fn opens_the_app_when_it_is_not_running() {
        let port = free_port();
        let (launched_tx, launched_rx) = mpsc::channel::<()>();
        let launched_tx = Mutex::new(launched_tx);
        let launch: Box<dyn Fn() -> Result<(), String> + Send + Sync> = Box::new(move || {
            launched_tx.lock().unwrap().send(()).unwrap();
            Ok(())
        });
        let (to, from) = relay(port, Some(launch));
        to.send(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_status"}}"#.into()).unwrap();
        // The relay asks for the app to be opened; the "app" then starts polling.
        launched_rx.recv_timeout(Duration::from_secs(5)).expect("the app was opened");
        let app = fake_app_once(port, |job| format!(r#"{{"id":"{}","ok":true,"output":{{"text":"Linked."}}}}"#, job.get("id").unwrap().as_str().unwrap()));
        let answer = recv(&from);
        app.join().unwrap();
        assert!(answer.to_json().contains("Linked."));
    }

    #[test]
    fn says_what_to_do_when_the_app_is_closed() {
        let port = free_port();
        let (to, from) = relay(port, None);
        to.send(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_status"}}"#.into()).unwrap();
        let answer = recv(&from);
        assert!(answer.to_json().contains("FORGEX 3D is not open"));
    }

    #[test]
    fn refuses_other_web_pages() {
        let port = free_port();
        let _relay = relay(port, None);
        thread::sleep(Duration::from_millis(200));
        let response = http(port, "GET /forgex/v1/poll HTTP/1.1\r\nHost: x\r\nOrigin: https://evil.example\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 403"));
        let hello = http(port, "GET /forgex/v1/hello HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(hello.contains("forgex-3d-relay"));
    }
}
