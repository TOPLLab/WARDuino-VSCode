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
    private content: Array<T>;

    constructor() {
        super();
        this.content = new Array<T>();
    }

    add(value: T): this {
        if (this.content.find(element => element.equals(value))) {
            this.content.push(value);
        }
        return this;
    }

    clear() {
        this.content = new Array<T>();
    }

    delete(value: T): boolean {
        const included: boolean = this.has(value);
        this.content = this.content.filter(element => !element.equals(value));
        return included;
    }

    has(value: T): boolean {
        return this.content.find(element => element.equals(value)) !== undefined;
    }

    values(): IterableIterator<T> {
        return new Set<T>(this.content).values();
    }
}
