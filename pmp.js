#!/usr/bin/env node

const { promisify } = require('util')
, glob = require('tiny-glob')
, args = process.argv.slice(2)
, chalk = require('chalk')
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
    stdin.on('end', async _ => {
        // console.log('done', `_${piped}_`)
        const curl = require('./curl')
        const p = curl.parse(piped)
        // console.log(p)

        const step = {
            [p.method]: `{{domain}}${p.path}`,
            headers: p.headers,
            prerequest: '',
            test: ''
        }
        if (p.data) step.body = { raw: p.data }

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
    })
    return
}


const commands = ['convert', 'run']
, isRun = args[0] === 'run'
, isConvert = args[0] === 'convert'
//let ok = args.length
let ok = isConvert && args.length === 2
if (!ok) ok = isRun && (args.length === 2 || args.length === 3)

if (!ok) return console.error(`
    PM+ - arguments required

    Some examples:
    - pm+ convert *.(json|yaml)  convert yaml from/to postman collection
    - pm+ run *.yaml [URL]       run the yaml via newman on given URL as {{domain}}

    WARNING: This utility will overwrite files without notice.
`)


glob(args[1]).then(async f => {
    const env = {
        values: [{
            enabled: true,
            key: 'domain',
            value: args[2] || 'http://localhost:3000',
            type: 'text'
        }]
    }
    , fromYaml = []
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

    if (isRun) run(env, files).then(totalErrors => {
        // cleanup temp files
        fromYaml.map(f => fs.unlinkSync(f))
        console.log('')
        if (totalErrors) console.error(` ${totalErrors} HARD errors found!`)
        else console.info('Yay! All tests passed.')
        process.exit(totalErrors ? 1 : 0)
    })
})

const rxSchema = /\/v2.[0-9].0\/collection.json/g
async function loadJson(fn) {
    let t = await readAsync(fn)
    try {
        const pm = JSON.parse(t)
        let ok = pm.info && pm.info.schema && rxSchema.test(pm.info.schema)
        if (ok) ok = Array.isArray(pm.item) && pm.item.length
        if (ok) ok = pm.item[0].request || pm.item[0].item
        if (ok) {
            const dat = await fromPostman(pm)
            const newfn = `${fn.substr(0, fn.length - 5)}.yaml`
            await writeAsync(newfn, dat)
            console.log(`👍 ${newfn} saved`)
        }
        else console.error(fn, 'Expected Postman ver 2.1.0 collection')
    }
    catch (err) {
        console.error(fn, err.stack)
    }
}


async function loadYaml(fn, isRun) {
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
    };
    
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

async function fromPostman(dat) {
    const info = dat.info
    delete info._postman_id

    const steps = []
    dat.item.map(item => {
        // TODO: handle folder
        const evt = {}
        if (item.event) item.event.map(e => {
            const s = e.script.exec.join('\n').replace(/\r/g, '')
            if (s.trim().length) evt[e.listen] = s
        })
        delete item.event

        const o = {}
        , req = { ...item.request }

        delete item.request
        if (item.response && item.response.length < 1) delete item.response

        const headers = req.header.reduce((p, c) => {
            p[c.key] = c.value
            return p
        }, {})

        delete req.body.mode
        const fdata = req.body.formdata
        if (req.body.raw) req.body.raw = req.body.raw.replace(/[\r\t]/g, '  ')
        else if (Array.isArray(fdata)) {
            // remove empty formdata entries
            req.body.formdata = fdata.filter(r => r.key.length)
        }

        o[item.name] = {
            [req.method]: req.url.raw || req.url,
            headers,
            body: req.body,
            ...evt,
            ...item
        }

        delete o[item.name].name
        steps.push(o)
    })

    const out = {
        ...info,
        steps
    }
    return yaml.dump(out)
}


// pm+ run
// - load yaml as text
// - eval text to run helpers
// - convert yaml to json
// - expand to postman collection json
// - save to pm collection
// - run newman

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

const rxSet = /set\(([A-Za-z,._\-0-9\ \/\=]*)\)/gm
function setVars(str, obj) {
    // console.log('...', str)
    const m = rxSet.exec(str)
    // support clear() to clear variables
    if (!m || !m[1]) return clearVars(str, obj)

    const vars = m[1]
    vars.split(',').map(v => {
        if (!v) return
        const [k, val] = v.split('=').map(s => s.trim())
        if (isNumber(val)) obj[k] = +val
        else obj[k] = val
    })
    return true
}

const rxClear = /clear\(([A-Za-z,._\-0-9\ \/\=]*)\)/gm
function clearVars(str, obj) {
    // console.log('... clear', str)
    const m = rxClear.exec(str)
    if (!m || !m[1]) return false
    const vars = m[1]
    if (vars.length)  vars.split(',').map(v => {
        if (!v) return
        delete obj[v.trim()]
    })
    else Object.keys(obj).map(k => delete obj[k]) // clear all
    return true
}

const rxIncl = /include\(([A-Za-z,._\-0-9\ \/\=]*)\)/gm
async function processInclude(file, pm) {
// include(file, [step, step])
    console.log('...', file)
    const m = rxIncl.exec(file)
    if (!m[1]) return
    let steps = m[1].split(',').map(t => t.trim()) 
    const fn = steps[0]
    if (!fs.existsSync(fn)) return

    const dat = yaml.load(fs.readFileSync(fn))
    , newSteps = []
    , vars = {}
    dat.steps.map(s => {
        // recursive resolution of includes
        // TODO: check for cyclic references to prevent stack overflow
        if (typeof s === 'string') {
            if (!setVars(s, vars)) newSteps.push(...processInclude(s))
        }
        else newSteps.push(s)
    })

    if (!pm) return newSteps
    dat.steps = newSteps

    steps = steps.slice(1)
    if (steps.length < 1) {
        dat.steps.map(step => makeStep(step, pm, vars))
        return
    }

    steps.map(s => {
        let step
        if (isNumber(s)) step = dat.steps[+s - 1]
        else step = dat.steps.find(o => typeof o !== 'string' && Object.keys(o)[0] === s)
        if (step) makeStep(step, pm, vars)
    })
}

function isNumber(n) {
    return !isNaN(parseFloat(n)) && isFinite(n)
}

// ---------------

async function runTest({ collection, environment }) {
    const newman = require('newman')
    return new Promise(done => {
        newman.run({ collection, environment,
            // bail: true,
            reporters: ['cli'],
            reporter: {
                cli: {
                    // noAssertions: true,
                    noFailures: true,
                    noSummary: true,
                    // silent: true
                }
            }
        })
        .on('done', (err, summary) => {
            // console.info(`   ${err ? chalk.red('✖') : chalk.green('✓')}  ${collection.info.name}  ${err ? chalk.red(err.name) : ''}`)
            // console.error(summary.run.failures)
            // summary.run.failures.map(fail => {
            //     const e = fail.error
            //     if (!e.test && e.message) console.error('  ', chalk.yellow(e.message))
            // })
            done(summary.run.failures.length)
            // can we get header from here?
            //console.log(summary)
            // console.log(this)
        })
    })
}

function validate(c, colFile) {
    let notGood = false, first = true
    let items = c.item;
    if (!c.info || !c.info.schema) throw Error('Invalid collection format - require postman collection v2.1')
    items.map(o => {
        let msg = ''
        if (!o.request || !o.request.url) {
            if (first) { console.log(''); first = false }
            console.log(chalk.gray(' skipping   ' + o.name))
            return false
        }

        if (o.request.body.mode === 'formdata') {
            //Form data has file element
            o.request.body.formdata
            .filter(e => e.type === 'file')
            .map(fdElem => {
                let fileWOExt = colFile.slice(0, -5) // remove .json from filename
                //let folderExits = fs.existsSync(`${path}/${fileWOExt}`);
                const fn = `${fdElem.description}`
                const fpath = `${_path}/${fileWOExt}`
                const ffn = `${fpath}/${fn}`
                let mockPathExists = fs.existsSync(fpath)
                let mockFileExists = fs.existsSync(ffn)

                console.log()
                // Make folder for collection if it uses request body contains mock file
                // And mock file exit
                fdElem.enabled = false                    
                if (mockFileExists) {
                    fdElem.src = `${_path}/${fileWOExt}/${fdElem.description}`
                    fdElem.enabled = true
                }
                else {
                    msg += `   - File not found: ${fdElem.description}\npath (${fpath}): ${mockPathExists ? 'exists' : 'not exists'}, ffn: ${ffn}\n`;
                }
            })
        }
        
        if (o.name.startsWith('http')) { msg += `   - add meaningful name\n` }

        const url = o.request.url.raw || o.request.url
        if (!url.startsWith('{{domain}}')) { msg += `   - {{domain}} not found in url\n` }

        if (!o.event || !o.event.filter(ev => ev.listen === 'test').length) {
            if (o.name.toLowerCase() !== 'login') msg += `   - No tests found!\n`
        }
        if (msg.length) {
            msg = chalk.red(` ❗  ${o.name}\n`) + msg
            if (first) { msg = '\n' + msg; first = false }
            console.log(msg)
            notGood = true
        }
    })
    if (notGood) {
        //console.error(issues)
        return false
    }
    return true
}

function run(env, files) {
    let errors = 0
    return files.reduce((cur, file) => cur.then(_ => {
        // we load collection using require
        // for better validation and handling
        let c = require(`${process.cwd()}/${file}`)
        // , name = ''
        // if (c && c.info) { name = c.info.name }
        console.log(`\n${chalk.bold.underline.whiteBright(`## ${file}`)}`)
        validate(c, file)

        // run sequentially
        return runTest({ collection: c, environment: env }).then(errs => {
            errors += errs || 0
        })
    }), Promise.resolve(0))
    .then(() => new Promise(done => {
        // if (errors) console.error(`\n     ${chalk.bold.underline.red(`!!! ${errors} ERRORS !!!`)}`)
        setTimeout(() => done(errors), 300)
    }))
}


// return loadYaml('test.yaml')

// ROADMAP
// - convert CURL to YAML https://github.com/tj/parse-curl.js
