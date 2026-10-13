"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileNameFromPath = fileNameFromPath;
exports.projectNameFromPath = projectNameFromPath;
exports.ensureProjectExtension = ensureProjectExtension;
const projectFile_1 = require("./projectFile");
/** `C:\Games\Car.forgex` → `Car.forgex` (handles both slash styles). */
function fileNameFromPath(path) {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
}
/** `C:\Games\Car.forgex` → `Car`. */
function projectNameFromPath(path) {
    const name = fileNameFromPath(path);
    const suffix = `.${projectFile_1.PROJECT_EXTENSION}`;
    return name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}
/** Adds `.forgex` when the chosen path has no extension of that name. */
function ensureProjectExtension(path) {
    return path.toLowerCase().endsWith(`.${projectFile_1.PROJECT_EXTENSION}`) ? path : `${path}.${projectFile_1.PROJECT_EXTENSION}`;
}
