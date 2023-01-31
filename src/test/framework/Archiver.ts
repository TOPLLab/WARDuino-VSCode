import {writeFileSync} from 'fs';

export class Archiver {
    private readonly information: any;
    private readonly archive: string;

    constructor(file: string) {
        this.information = new Map<string, string[]>();
        this.archive = file;
    }

    public set(key: string, value: string | number) {
        this.information[key] = value;
    }

    public extend(key: string, value: string | number) {
        if (!this.information.hasOwnProperty(key)) {
            this.information[key] = [];
        }
        this.information[key].push(value);
    }

    public write() {
        writeFileSync(this.archive, `${JSON.stringify(this.information, null, 2)}\n`, {flag: 'w'});
    }

    // TODO also add access functions to compare with previous runs
}