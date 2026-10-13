"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeFileAtomically = writeFileAtomically;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
/** Same safety rule as the desktop app: write a temporary file, then rename it over the target. */
async function writeFileAtomically(target, contents) {
    const temp = (0, node_path_1.join)((0, node_path_1.dirname)(target), `.${(0, node_path_1.basename)(target)}.saving`);
    try {
        await (0, promises_1.writeFile)(temp, contents, 'utf8');
        await (0, promises_1.rename)(temp, target);
    }
    catch (error) {
        await (0, promises_1.unlink)(temp).catch(() => undefined);
        throw error;
    }
}
