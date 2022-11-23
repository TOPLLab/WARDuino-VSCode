import {MochaOptions, reporters, Runner, Suite, Test} from 'mocha';
import color = reporters.Base.color;
import colors = reporters.Base.colors;
import symbols = reporters.Base.symbols;

/* Change color output */

colors.suite = 95; // purple
colors.fail = 90; // grey
colors.error = 31; // red

/* Helper functions for formatting */

function seconds(ms: number): string {
    return `${(ms / 1000).toFixed(0)}s`;
}

function formatThrownError(message: string): string {
    const substring = message.match(/the string "(.*)" was/);
    return substring !== null ? substring[1] : message;
}

function formatTimout(message: string): string {
    const limit = message.match(/Timeout of ([0-9]*)ms exceeded./);
    if (limit) {
        return `test exceeded time limit (${limit[1]}ms)`;
    }
    return message;
}

/** Custom Reporter for Describer framework */

class Reporter extends reporters.Base {
    private readonly indentationSize: number = 2;
    private indentationLevel: number = 0;

    private failed: number = 0;  // number of failed suites
    public failures = Array<any>();  // array to keep failed tests of suite (temporarily)

    constructor(runner: Runner, options?: MochaOptions) {
        super(runner, options);

        runner.on(Runner.constants.EVENT_RUN_BEGIN, () => {
            // TODO report general information:
            // + information about the describer
            // + information about the VM (commit)
            // + information about the system the test/vm are being run on
        });

        runner.on(Runner.constants.EVENT_SUITE_BEGIN, (suite: Suite) => {
            ++this.indentationLevel;
            console.log(color('suite', '%s%s'), this.indent(), suite.title);
        });

        runner.on(Runner.constants.EVENT_SUITE_END, (suite: Suite) => {
            if (this.failures.length > 0) {
                this.failed++;
            }

            this.reportFailure(this.failures);
            this.failures = Array<any>();

            if (suite.isPending()) {
                let format = this.indent(this.indentationLevel + 1) + '\u25D7 Skipping test';
                console.log(format);
            }

            --this.indentationLevel;
            if (this.indentationLevel === 1) {
                console.log();
            }
        });

        runner.on(Runner.constants.EVENT_TEST_PASS, (test) => {
            let format = this.indent() + color('checkmark', '  ' + symbols.ok) + ' %s';

            if (test.speed === 'fast' || test.speed === undefined) {
                console.log(format, test.title);
            } else {
                format += color(test.speed, ' (%dms)');
                console.log(format, test.title, test.duration);
            }
        });

        runner.on(Runner.constants.EVENT_TEST_FAIL, (test: Test, error: any) => {
            console.log(this.indent(this.indentationLevel + 1) + color('fail', symbols.err + ' %s'), test.title);
            console.log(color('error', `${this.indent(this.indentationLevel + 2)} ${this.reportFailure(error)}`));
            this.failures.push(error);
        });

        runner.once(Runner.constants.EVENT_RUN_END, () => {
            const stats = runner.stats;

            console.log();

            // passes
            let fmt =
                color('bright pass', this.indent(1)) +
                color('green', ' %d passing') +
                color('light', ' (%s)');

            console.log(fmt, (stats?.suites ?? this.failed) - this.failed, seconds(stats?.duration ?? 0));

            // pending
            if (stats?.pending) {
                fmt = color('pending', this.indent(1)) + color('pending', ' %d skipped');

                console.log(fmt, stats?.pending);
            }

            // failures
            if (stats?.failures) {
                fmt = color('error', `${this.indent(1)} %d failing`);

                console.log(fmt, this.failed);

                this.failures.forEach((failure) => {
                    this.reportFailure(failure);
                });
                console.log();
            }

            console.log();
        });
    }

    private indent(override?: number): string {
        return ' '.repeat((override ?? this.indentationLevel) * this.indentationSize);
    }

    private reportFailure(failure: any): string | undefined {
        const message = failure.message?.toString();

        let prologue = 'Failure: ';
        if (skippedTest(failure)) {
            return message;
        } else if (showCustomComparatorError(failure)) {
            return prologue + message.split(':').slice(0, -1).join('');
        } else if (showDifference(failure)) {
            return prologue + `runtime returned '${failure.actual}' (expected: ${failure.expected})`;
        } else if (message?.includes('throw an Error :)')) {
            return prologue + formatThrownError(message);
        } else if (message?.includes('Timeout')) {
            return prologue + formatTimout(message);
        } else {
            return prologue + message;
        }
    }
}

function skippedTest(failure: any): boolean {
    return failure.message?.includes('Skip');
}

function showDifference(failure: any): boolean {
    return failure.showDiff && failure.actual !== failure.exception;
}

function showCustomComparatorError(failure: any): boolean {
    return failure.showDiff && failure.expected === true;
}

export = Reporter;