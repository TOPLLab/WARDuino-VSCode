import {writeFileSync} from 'fs';

export class Archiver {
    private information: Map<string, Array<string>>;
    private archive: string;

    constructor(file: string) {
        this.information = new Map<string, Array<string>>();
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
}