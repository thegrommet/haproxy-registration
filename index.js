#!/usr/bin/env node
const argv = require('yargs')
    .option('host', {
        alias: 'h',
        description: 'HAProxy host',
        demandOption: true
    })
    .option('port', {
        alias: 'p',
        description: 'HAProxy port',
        default: 1337,
        coerce: Number
    })
    .argv;

main(argv);

async function main(argv) {
}
