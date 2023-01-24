import {writeFileSync} from 'fs';

export class Archiver {
    private readonly information: Map<string, string[]>;
    private readonly archive: string;

    constructor(file: string) {
        this.information = new Map<string, string[]>();
        this.archive = file;
    }

    public set(key: string, value: string) {
        this.information.set(key, [value]);
    }

    public extend(key: string, value: string) {
        if (!this.information.has(key)) {
            this.information.set(key, []);
        }
        this.information.get(key)?.push(value);
    }

    public write() {
        writeFileSync(this.archive, `${JSON.stringify(Object.fromEntries(this.information))}\n`, {flag: 'w'});
    }

    // TODO also add access functions to compare with previous runs
}