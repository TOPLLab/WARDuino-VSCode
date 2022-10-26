import {MochaOptions, reporters, Runner} from 'mocha';
import Spec = reporters.Spec;

class Reporter extends Spec {
    constructor(runner: Runner, options?: MochaOptions) {
        super(runner, options);
    }
}

export = Reporter;