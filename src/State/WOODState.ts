import {spawn} from "child_process";

const path: string = "/home/tolauwae/Documents/out-of-things/warduino"; // TODO add to config

export class WOODState {
    private unparsedJSON = "";

    constructor(state: string) {
        this.unparsedJSON = state.trimEnd();
    }

    async toBinary(offset: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            let process = spawn("python3", ["cli.py", this.unparsedJSON, offset], {
                cwd: path
            });

            process.stdout?.on("data", (data: Buffer) => {
                resolve(Buffer.from(data.toString(), "base64").toString("ascii").split("\n"));
            });

            process.stderr?.on("data", (data) => {
                console.log(`stderr: ${data}`);
                reject(data);
            });
        });
    }
}