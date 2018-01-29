#!/usr/bin/env node

const argv = require('yargs')
    .option('host', {
        alias: 'h',
        description: 'HAProxy host',
        demandOption: true,
        requiresArg: true,
        type: 'string'
    })
    .option('port', {
        alias: 'p',
        description: 'HAProxy port',
        default: 1337,
        requiresArg: true,
        type: 'number'
    })
    .argv

const main = require('async-main').default
const isec2 = require('is-ec2-machine')
const ec2meta = require('aws-instance-metadata')
const myLocalIP = require('my-local-ip')

main(async function main() {
    const ip = await getIP()
    
    console.warn(ip)
})

async function getIP() {
    if (isec2()) {
        return await ec2meta('public-ipv4') || await ec2meta('local-ipv4')
    } else {
        return myLocalIP()
    }
}
