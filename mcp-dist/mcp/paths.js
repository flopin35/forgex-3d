"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultProjectsFolder = defaultProjectsFolder;
exports.resolveProjectPath = resolveProjectPath;
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const paths_1 = require("../src/core/project/paths");
/** Where relative project names go: FORGEX_PROJECTS_DIR, or Documents\FORGEX 3D. */
function defaultProjectsFolder() {
    const configured = process.env.FORGEX_PROJECTS_DIR?.trim();
    return configured ? (0, node_path_1.resolve)(configured) : (0, node_path_1.resolve)((0, node_os_1.homedir)(), 'Documents', 'FORGEX 3D');
}
/** "kart" → <projects folder>\kart.forgex; absolute paths are kept. Always ends in .forgex. */
function resolveProjectPath(input, folder) {
    const trimmed = input.trim();
    return (0, paths_1.ensureProjectExtension)((0, node_path_1.isAbsolute)(trimmed) ? (0, node_path_1.resolve)(trimmed) : (0, node_path_1.resolve)(folder, trimmed));
}
