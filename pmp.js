#!/usr/bin/env node

const { promisify } = require('util')
, arg = require('yargs').argv
, glob = require('tiny-glob')
, fs = require('fs')
, readAsync = promisify(fs.readFile)
, writeAsync = promisify(fs.writeFile)
, yaml = require('js-yaml')
, stdin = process.stdin

if (!stdin.isTTY) {
    let piped = ''
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', data => piped += data)
    stdin.on('end', _ => curl2Yaml(piped))
    return
}

const isRun = arg.run || arg.r
, isConvert = arg.convert || arg.c

if (require.main === module) {
    let ok = isConvert  || isRun
    if (!ok || arg.h) return console.error(`
PM+ - arguments required

Some examples:
- pm+ --convert "*.(json|yaml)"  convert yaml from/to postman collection
- pm+ --run "file" [-u URL]      run newman tests on given URL as {{domain}}

* URL defaults to http://localhost:3000

Shorthands:
-c --convert
-r --run

WARNING: This utility will overwrite files without notice.
`)

    // tpl - nunjucks template for tests functions
    // @include(tests from nunjucks template)
    // pm+ docs
    // pm+ clean < curl

    runFiles(arg.r || arg.run || arg.c || arg.convert, arg.u, { isConvert, isRun })
}

function runFiles(pattern, domain, { isConvert, isRun }) {
    // console.log('run',{ pattern, domain, isConvert , isRun })
    const { loadJson } = require('./lib/pmcollection')
    const { run } = require('./lib/runner')

    glob(pattern).then(async f => {
        const fromYaml = []
        return console.log(f.join('\n'))
        const files = await f.reduce(async (p, f) => {
            p = await p
            if (f.endsWith('.json')) {
                if (isConvert) await loadJson(f)
                p.push(f)
            }
            else if (f.endsWith('.yaml')) {
                const fn = await loadYaml(f, isRun)
                if (fn) {
                    p.push(fn)
                    fromYaml.push(fn)
                }
            }
            return p
        }, Promise.resolve([]))
    
        if (isRun) {
            const env = {
                values: [{
                    enabled: true,
                    key: 'domain',
                    value: domain || 'http://localhost:3000',
                    type: 'text'
                }]
            }
        
            run(env, files).then(totalErrors => {
                // cleanup temp files
                fromYaml.map(f => fs.unlinkSync(f))
                console.log('')
                if (totalErrors) console.error(` ${totalErrors} HARD errors found!`)
                else if (files.length) console.info('Yay! All tests passed.')
                else console.warn('Nothing to run?')
                process.exit(totalErrors ? 1 : 0)
            })
        }
    })    
}

async function loadYaml(fn, isRun) {
    const { processInclude, setVars } = require('./lib/macros')
    let t = await readAsync(fn)
    try {
        // t = t.toString().replace(/`/g, '\\`')
        // eval(`t = \`${t}\` `)
        const dat = yaml.load(t)
        , pm = {
            info: {
                name: dat.name,
                schema: dat.schema
            },
            item: [],
        }
        , vars = {}
        dat.steps.map(step => {
            if (typeof step === 'string') {
                if (setVars(step, vars)) return
                // include(file, [step, step])
                return processInclude(step, pm)
            }
            makeStep(step, pm, vars)
        })

        const fn2 = `${isRun ? `${fn}_${+new Date()}` : fn.substr(0, fn.length - 5)}.json`
        await writeAsync(fn2, JSON.stringify(pm, null, 2))
        return fn2
    }
    catch (err) {
        console.error(fn, ':', err.stack)
    }
    return null
}

function makeStep(step, pm, vars) {
    const det = Object.values(step)[0]
    , fdata = det.body.formdata

    delete det.body.mode
    det.body.mode = Object.keys(det.body)[0]
    if (Array.isArray(fdata)) {
        det.body.formdata = fdata.map(r => {
            if (typeof f !== 'string') return r
            return processFile(r)
        }).filter(r => r)
    }
    const request = {
        header: Object.keys(det.headers).map(key => ({
            key,
            type: 'text',
            value: det.headers[key]
        })),
        body: det.body
    }
    
    if (vars) {
        const presets = []
        Object.keys(vars).map(k => {
            let v = vars[k]
            if (typeof v === 'string') v = `'${v}'`
            presets.push(`pm.variables.set('${k}', ${v});`)
        })
        if (presets.length) det.prerequest = `${presets.join('\n')}\n${det.prerequest || ''}`
    }
    const event = []
    addEvent('prerequest', event, det)
    addEvent('test', event, det)
    // console.log('event', det.prequest, event)

    const VERBS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'TRACE', 'OPTIONS',
        'COPY', 'LINK', 'UNLINK', 'PURGE', 'LOCK', 'UNLOCK', 'PROPFIND', 'VIEW']
    VERBS.map(v => {
        if (!det[v]) return
        const url = det[v].split('/')
        request.method = v
        request.url = {
            raw: det[v],
            host: [url[0]],
            path: url.slice(1)
        }
    })
    const name = Object.keys(step)[0]
    console.log('>>', name)
    pm.item.push({
        name,
        event,
        protocolProfileBehavior: det.protocolProfileBehavior,
        request,
        response: det.response
    })
}

function addEvent(key, events, det) {
    // console.log('addevent', key, det[key] !== undefined)
    if (!det[key]) return
    events.push({
        listen: key,
        script: {
            exec: det[key].split('\n'),
            type: "text/javascript"
        }
    })
}

async function curl2Yaml(piped) {
    const { isJsonContent } = require(`${__dirname}/lib/pmcollection`)
    const curl = require('./lib/curl')
    const p = curl.parse(piped)
    // console.log(p)

    const step = {
        [p.method]: `{{domain}}${p.path}`,
        headers: p.headers,
        prerequest: '',
        test: ''
    }
    if (p.data) {
        if (isJsonContent(p.headers)) {
            p.data = JSON.stringify(JSON.parse(p.data), null, 2)
        }
        step.body = { raw: p.data }
    }

    const pm = {
        info: {
            name: `From Curl`,
            schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
        },
        steps: [],
    }
    pm.steps.push({
        [`${p.method} ${p.path}`]: step
    })

    const fn = `curl_${+new Date()}.yaml`
    await writeAsync(fn, yaml.dump(pm))
    console.log(`👍 ${fn} saved`)
}

const rxFile = /file\(([A-Za-z,._\-0-9\ \/\=]*)\)/gm
async function processFile(text) {
    const m = rxFile.exec(text)
    const file = m[1]
    if (!file) return null

    return {
        key: 'file',
        description: file,
        type: 'file',
        src: file
    }
}

module.exports = { runFiles }
// return loadYaml('test.yaml')

// ROADMAP
// - convert CURL to YAML https://github.com/tj/parse-curl.js
