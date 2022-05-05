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
    .command({
        command: 'register',
        description: 'Register with haproxy'
    })
    .command({
        command: 'unregister',
        description: 'Unregister with haproxy'
    })
    .command({
        command: 'daemon',
        description: 'Run as a daemon that keeps registration up to date'
    })
    .demandCommand(1)
    .argv

const lodash = require('lodash')
const main = require('async-main').default
const net = require('net')
const debug = require('util').debuglog('haproxy-registration')

main(async function main() {
    debug('command', argv[0])
    if (argv._[0] == 'register') return register();
    if (argv._[0] == 'unregister') return unregister();
    if (argv._[0] == 'daemon') return daemon();
})

function wait(ms) {
    return new Promise((y, n) => setTimeout(y, ms))
}

async function daemon() {
    let keep = true;

    function done() {
        keep = false
    }
    process.on('SIGTERM', done)
    process.on('SIGINT', done)
    process.on('SIGQUIT', done)

    while (keep) {
        await register();
        await wait(10000);
    }
    await unregister();
}

async function register() {
    const ip = myLocalIP()
    
    const servers = await getServers(argv.host, argv.port, argv.backend)
    if (servers.find(e => e.srv_addr == ip)) {
        debug(`${ip} already registered`)
    } else {
        const slot = findSlot(servers)
        debug("found slot", slot)
        console.log(`registering ${ip} as ${slot.be_name}/${slot.srv_name}`)
        if (!slot) throw new Error(`Could not find free slot for ${ip} in backend ${argv.backend}`)
        const resp = await haproxy(argv.host, argv.port, `set server ${argv.backend}/${slot.srv_name} addr ${ip}`)
        debug("set server response", resp)
        const resp2 = await haproxy(argv.host, argv.port, `set server ${argv.backend}/${slot.srv_name} state ready`)
        debug("enable server response", resp2)
    }
}

async function unregister() {
    const ip = myLocalIP()
    const servers = await getServers(argv.host, argv.port, argv.backend)
    if (servers.find(e => e.srv_addr == ip)) {
        const slot = findActiveSlot(servers, ip)
        if (!slot) throw new Error(`Could not find existing slot for ${ip} in backend ${argv.backend}`)
        console.log(`unregistering ${ip} from ${slot.be_name}/${slot.srv_name}`)
        const resp2 = await haproxy(argv.host, argv.port, `set server ${argv.backend}/${slot.srv_name} state maint`)
        debug("enable server response", resp2)
        const resp = await haproxy(argv.host, argv.port, `set server ${argv.backend}/${slot.srv_name} addr 0.0.0.0`)
        debug("set server response", resp)
    } else {
        debug(`${ip} not registered`)
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

function findActiveSlot(servers, ip) {
    return servers.find(e => {
        if (e.srv_addr == ip && (e.srv_admin_state & 1) == 0) {
            debug("found active slot", e)
            return true
        }
        return false
    })
}

function findSlot(servers) {
    // If no unregistered slots exist, choose a downed server or administratively downed slot
    return servers.find(e => {
        if (e.srv_op_state == 0 && e.srv_time_since_last_change > 300) {
            debug("Found downed slot older than 300 seconds")
            return true
        }
        if (e.srv_admin_state & 1) {
            debug("Found administratively down slot")
            return true
        }
        return false
    })
}

function myLocalIP() {
    var n = require('os').networkInterfaces()
    var ip = []
    for(var k in n) {
        var inter = n[k]
        for(var j in inter)
            if((inter[j].family === 'IPv4' || inter[j].family === 4) && !inter[j].internal)
                return inter[j].address
    }
}
