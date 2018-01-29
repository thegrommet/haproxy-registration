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
    .option('backend', {
        alias: 'b',
        description: 'Backend',
        demandOption: true,
        requiresArg: true,
        type: 'string'
    })

    .argv

const ec2meta = require('aws-instance-metadata')
const isec2 = require('is-ec2-machine')
const lodash = require('lodash')
const main = require('async-main').default
const myLocalIP = require('my-local-ip')
const net = require('net')
const debug = require('util').debuglog('haproxy-registration')

main(async function main() {
    const ip = await getIP()
    
    const servers = await getServers(argv.host, argv.port, argv.backend)
    if (servers.find(e => e.srv_addr == ip)) {
        console.log(`${ip} already registered`)
    } else {
        console.log(`registering ${ip}`)
        const slot = findSlot(servers)
        debug("found slot", slot)
        if (!slot) throw new Error(`Could not find free slot for ${ip} in backend ${argv.backend}`)
        const resp = await haproxy(argv.host, argv.port, `set server ${argv.backend}/${slot.srv_name} addr ${ip}`)
        debug("set server response", resp)
        const resp2 = await haproxy(argv.host, argv.port, `enable server ${argv.backend}/${slot.srv_name}`)
        debug("enable server response", resp2)
    }
})

async function getIP() {
    if (isec2()) {
        return await ec2meta('public-ipv4') || await ec2meta('local-ipv4')
    } else {
        return myLocalIP()
    }
}

async function haproxy(host, port, command) {
    debug("command to", host, port, ':', command)
    return new Promise((accept, reject) => {
        let out = '';
        const socket = net.connect({ host, port, encoding: 'utf-8', allowHalfOpen: true }, function () {
            socket.end(`${command}\r\n`);
            socket.on('readable', function () {
                let x;
                while (x = socket.read()) {
                    out = out.concat(x)
                }
            })
            socket.on('end', () => accept(out))
        })
        socket.on('error', reject)
    })
}

async function getServers(host, port, backend) {
    const servers = await haproxy(host, port, `show servers state ${backend}`)
    const body = servers.split(/\r?\n/).map(server => server.split(" ")).slice(1)
    const header = body.shift().slice(1)
    const rval = body.map(e => lodash.zipObject(header, e)).filter(e => e.be_name == backend)
    if (rval.length == 0) throw new Error(`No servers found for backend ${backend}`)
    return rval
}

function findSlot(servers) {
    return servers.find(e => {
        if (e.srv_admin_state != 0 && e.srv_time_since_last_change > 300) return true
        if (e.srv_admin_state & 1) return true;
        return false;
    })
}
