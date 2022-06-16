abstract class Comparable {
    public abstract equals(other: Comparable): boolean;
}

export class Breakpoint extends Comparable {
    id: number;  // address
    verified: boolean = true;
    line: number;
    column?: number;

    constructor(id: number, line: number) {
        super();
        this.id = id;
        this.line = line;
    }

    public equals(other: Breakpoint): boolean {
        return other.id === this.id;
    }
}

export class UniqueSet<T extends Comparable> extends Set {
    constructor() {
        super();
    }

    add(value: T): this {
        if (!this.has(value)) {
            super.add(value);
        }
        return this;
    }

    has(value: T): boolean {
        return Array.from<T>(this.values()).find(element => element.equals(value)) !== undefined;
    }
}
