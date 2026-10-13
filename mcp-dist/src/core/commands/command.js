"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompositeCommand = void 0;
/** Runs several commands as one undo step. */
class CompositeCommand {
    label;
    commands;
    selectAfterApply;
    constructor(label, commands, selectAfterApply) {
        this.label = label;
        this.commands = commands;
        this.selectAfterApply = selectAfterApply;
    }
    apply(scene) {
        return this.commands.reduce((current, command) => command.apply(current), scene);
    }
    revert(scene) {
        return [...this.commands].reverse().reduce((current, command) => command.revert(current), scene);
    }
}
exports.CompositeCommand = CompositeCommand;
