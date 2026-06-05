import { Timeline } from './timeline.js';

export class ExecutionEngine {
    constructor() {
        this.timeline = new Timeline();
        this.isPlaying = false;
        this.speed = 1000; // default 1000ms
        this.timer = null;
        this.stepChangeCallbacks = [];
        this.playStateCallbacks = [];
    }

    onStepChange(callback) {
        this.stepChangeCallbacks.push(callback);
    }

    onPlayStateChange(callback) {
        this.playStateCallbacks.push(callback);
    }

    notifyStepChange() {
        const snapshot = this.timeline.getCurrent();
        if (!snapshot) return;
        for (let cb of this.stepChangeCallbacks) {
            cb(snapshot, this.timeline.currentIndex, this.timeline.getLength());
        }
    }

    notifyPlayStateChange() {
        for (let cb of this.playStateCallbacks) {
            cb(this.isPlaying);
        }
    }

    initialize(steps, treeRoot) {
        this.pause();
        this.timeline.clear();
        
        // Map Python trace steps directly to timeline snapshots
        for (let step of steps) {
            this.timeline.push({
                currentNodeId: step.node_id,
                codeLine: step.line,
                stack: step.stack,
                nodeStates: step.node_states,
                inspector: {
                    locals: step.locals,
                    globals: step.globals || {}
                }
            });
        }

        this.timeline.jumpTo(0);
        this.notifyStepChange();
    }

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.notifyPlayStateChange();
        this.runTimer();
    }

    pause() {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        this.notifyPlayStateChange();
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    runTimer() {
        if (!this.isPlaying) return;
        this.timer = setTimeout(() => {
            const hasNext = this.next();
            if (hasNext) {
                this.runTimer();
            } else {
                this.pause();
            }
        }, this.speed);
    }

    next() {
        const hasNext = this.timeline.next();
        if (hasNext) {
            this.notifyStepChange();
        }
        return hasNext;
    }

    prev() {
        const hasPrev = this.timeline.prev();
        if (hasPrev) {
            this.notifyStepChange();
        }
        return hasPrev;
    }

    jumpTo(index) {
        const success = this.timeline.jumpTo(index);
        if (success) {
            this.notifyStepChange();
        }
        return success;
    }

    setSpeed(speedMs) {
        this.speed = speedMs;
        if (this.isPlaying) {
            if (this.timer) clearTimeout(this.timer);
            this.runTimer();
        }
    }
}
