import {MochaOptions, reporters, Runner, Test} from 'mocha';
import color = reporters.Base.color;
import colors = reporters.Base.colors;
import symbols = reporters.Base.symbols;

colors.suite = 95; // purple
colors.fail = 90; // grey
colors.error = 31; // red

function seconds(ms: number): string {
    return `${(ms / 1000).toFixed(0)}s`;
}

class Reporter {
    private readonly indentationSize: number = 2;
    private indentationLevel: number = 0;

    private failed: number = 0;
    private failures = Array<any>();

    constructor(runner: Runner, options?: MochaOptions) {
        runner.on(Runner.constants.EVENT_RUN_BEGIN, () => {
        });

        runner.on(Runner.constants.EVENT_SUITE_BEGIN, (suite) => {
            ++this.indentationLevel;
            console.log(color('suite', '%s%s'), this.indent(), suite.title);
        });

        runner.on(Runner.constants.EVENT_SUITE_END, (suite) => {
            this.reportFailure(this.failures);
            this.failures = Array<any>();

            --this.indentationLevel;
            if (this.indentationLevel === 1) {
                console.log();
            }
        });

        runner.on(Runner.constants.EVENT_TEST_PASS, (test) => {
            let format = this.indent() + color('checkmark', '  ' + symbols.ok) + color('pass', ' %s');

            if (test.speed === 'fast' || test.speed === undefined) {
                console.log(format, test.title);
            } else {
                format += color(test.speed, ' (%dms)');
                console.log(format, test.title, test.duration);
            }
        });

        runner.on(Runner.constants.EVENT_TEST_FAIL, (test: Test, error: any) => {
            console.log(this.indent() + color('fail', '  %d) %s'), ++this.failed, test.title);
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

            console.log(fmt, stats?.passes || 0, seconds(stats?.duration ?? 0));

            // pending
            if (stats?.pending) {
                fmt = color('pending', ' ') + color('pending', ' %d pending');

                console.log(fmt, stats?.pending);
            }

            // failures
            if (stats?.failures) {
                fmt = color('fail', `${this.indent(1)} %d failing`);

                console.log(fmt, stats?.failures);

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
        let prologue = 'Failure: ';
        if (failure.showDiff) {
            return prologue + `runtime returned '${failure.actual}' (expected: ${failure.expected})`;
        } else if (failure.message?.toString().includes('Timeout')) {
            return prologue + 'timeout';
        } else {
            return prologue + failure.message;
        }
    }
}

export = Reporter;