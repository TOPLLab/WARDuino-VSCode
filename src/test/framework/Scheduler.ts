import {TestDescription} from './Describer';
import {Suite} from './Framework';

export abstract class Scheduler {
    // sort the tests into an efficient schedule
    abstract schedule(suite: Suite): TestDescription[];
}

class NoScheduler implements Scheduler {
    public schedule(suite: Suite): TestDescription[] {
        return suite.tests;
    }
}

class SimpleScheduler implements Scheduler {
    public schedule(suite: Suite): TestDescription[] {
        // get trees
        const forest = trees(suite.tests);
        // sort trees by program
        forest.forEach(tree => tree.sort((a: TestDescription, b: TestDescription) => a.program.localeCompare(b.program)));
        // flatten forest
        return forest.flat(2);
    }
}

/*
 * The Hybrid Scheduler respects dependency trees while minimising the need to change programs.
 *
 * The schedule iterates breadth-first over each tree in succession,
 * at each depth the tests are sorted alphabetically according to their program.
 */
export class HybridScheduler implements Scheduler {
    public schedule(suite: Suite): TestDescription[] {
        let scheme: TestDescription[] = [];
        const forest: TestDescription[][] = trees(suite.tests);
        for (const tree of forest) {
            const split = levels(tree);
            split.forEach(level => level.sort(sortOnProgram));
            scheme = scheme.concat(split.flat(2));
        }
        return scheme;
    }
}

export class DependenceScheduler implements Scheduler {
    public schedule(suite: Suite): TestDescription[] {
        const schedule: TestDescription[][] = levels(suite.tests);
        schedule.forEach(level => level.sort(sortOnProgram));
        return schedule.flat(2);  // we flatten since we don't support parallelism yet (otherwise tests in the same level can be run in parallel)
    }
}

/* util functions */

function sortOnProgram(a: TestDescription, b: TestDescription) {
    // aggregate tests with the same program
    return a.program.localeCompare(b.program);
}

// aggregate dependence forest into trees
function trees(input: TestDescription[]): TestDescription[][] {
    // sort input
    input.sort(comparator);

    // output
    const forest: TestDescription[][] = [];

    // tests that have already been seen
    const seen = new Set<TestDescription>();

    // loop over all tests of the input
    for (const test of input) {
        if (seen.has(test)) {
            // when seen includes test: test already in forest, nothing to do
            break;
        }
        // start a new tree
        let tree: TestDescription[] = [test];

        // add test to seen
        seen.add(test);

        // depth first descent over dependencies
        let lifo: TestDescription[] = [...test.dependencies ?? []];
        while (lifo.length > 0) {
            const dep = lifo.shift();

            // @ts-ignore
            if (seen.has(dep)) {
                // dependency has been seen: merge the old tree holding the dependency with the new tree
                // @ts-ignore
                const index = forest.findIndex(t => t.includes(dep));
                if (index < 0) {
                    // already merged the tree
                    break;
                }
                const oldTree = forest[index];

                // extend new tree with old tree
                tree = tree.concat(oldTree);

                // remove old tree from forest
                forest.splice(index, 1);
            } else {
                // dependency has not been seen: add dependency
                // @ts-ignore
                tree.push(dep);

                // traverse its dependencies recursively
                // @ts-ignore
                lifo = lifo.concat(dep.dependencies ?? []);

                // add dependency to seen collection
                // @ts-ignore
                seen.add(dep);
            }
        }

        // update forest
        forest.push(tree);
    }

    return forest;
}

function comparator(a: TestDescription, b: TestDescription): number {
    let comparison: number = (b.dependencies ?? []).length - (a.dependencies ?? []).length; // decreasing amount of dependencies
    if (comparison === 0) {
        comparison = sortOnProgram(a, b);
        if (comparison === 0) {
            comparison = a.title.localeCompare(b.title);
        }
    }
    return comparison;
}

// aggregate dependence forest into levels
function levels(input: TestDescription[]): TestDescription[][] {
    // input
    input.sort((a: TestDescription, b: TestDescription) => (a.dependencies ?? []).length - (b.dependencies ?? []).length);
    // output
    const levels: TestDescription[][] = [];

    // while more input remains
    while (input.length > 0) {
        // @ts-ignore
        const test: TestDescription = input.shift();

        // skip any test with unresolved dependencies
        let skip: boolean = (test.dependencies ?? []).some((dependence: TestDescription) => input.includes(dependence));

        if (skip) {
            input.push(test);
            break;
        }

        // add to level below
        const level: number = lowest(test, levels) + 1;
        if (levels[level] === undefined) {
            levels[level] = [];
        }
        levels[level].push(test);
    }

    return levels;
}

// get the lowest level of dependencies for a test
function lowest(test: TestDescription, levels: TestDescription[][]): number {
    for (let i = levels.length - 1; i >= 0; i--) {
        for (const level of levels[i] ?? []) {
            if (test.dependencies?.includes(level)) {
                return i;
            }
        }
    }
    return -1;
}