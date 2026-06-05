export class Timeline {
    constructor() {
        this.snapshots = [];
        this.currentIndex = -1;
    }

    clear() {
        this.snapshots = [];
        this.currentIndex = -1;
    }

    push(snapshot) {
        this.snapshots.push(snapshot);
        if (this.currentIndex === -1) {
            this.currentIndex = 0;
        }
    }

    getCurrent() {
        if (this.currentIndex >= 0 && this.currentIndex < this.snapshots.length) {
            return this.snapshots[this.currentIndex];
        }
        return null;
    }

    next() {
        if (this.currentIndex < this.snapshots.length - 1) {
            this.currentIndex++;
            return true;
        }
        return false;
    }

    prev() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            return true;
        }
        return false;
    }

    jumpTo(index) {
        if (index >= 0 && index < this.snapshots.length) {
            this.currentIndex = index;
            return true;
        }
        return false;
    }

    getLength() {
        return this.snapshots.length;
    }
}
