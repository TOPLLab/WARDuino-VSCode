import {spawn} from "child_process";
import {promises as fsPromises} from 'fs';
import * as vscode from "vscode";

const path: string = vscode.workspace.getConfiguration().get("warduino.OutOfThings") ?? ".";

export class WOODState {
    private unparsedJSON = "";
    public callbacks = "";

    constructor(state: string) {
        this.unparsedJSON = state.trimEnd();
    }

    async toBinary(tmpdir: string, offset: string): Promise<string[]> {
        await fsPromises.writeFile(`${tmpdir}/unparsed.json`, this.unparsedJSON);

        return new Promise((resolve, reject) => {
            let process = spawn("python3", ["cli.py", `${tmpdir}/unparsed.json`, offset], {
                cwd: path
            });
            const pyLoggerName = "OutOfThings";

            const b64buffers: Buffer[] = [];

            process.stdout?.on("data", (data: Buffer) => {
                b64buffers.push(data);
            });

            process.on("close", (code) => {
                console.log(`Spawned 'cli.py' done exit code: ${code}`);
                const data = Buffer.concat(b64buffers)
                resolve(Buffer.from(data.toString(), "base64").toString("ascii").split("\n"));
            });

            process.stderr?.on("data", (data) => {
                if (data.includes(pyLoggerName)) {
                    console.log(`${data}`);
                } else {
                    console.log(`stderr: ${data}`);
                    reject(data);
                }
            });
        });
    }
}
