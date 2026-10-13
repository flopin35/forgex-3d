"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIEW_PRESETS = exports.ToolError = void 0;
/** A problem the caller can fix (bad arguments, unknown object). Reported back to the AI, not thrown as a crash. */
class ToolError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolError';
    }
}
exports.ToolError = ToolError;
exports.VIEW_PRESETS = ['current', 'perspective', 'front', 'back', 'left', 'right', 'top', 'bottom'];
