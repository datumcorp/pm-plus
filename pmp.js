#!/usr/bin/env node

const glob = require('tiny-glob')
, args = process.argv.slice(2)
, fs = require('fs')
, { promisify } = require('util')
, readAsync = promisify(fs.readFile)
, writeAsync = promisify(fs.writeFile)
, yaml = require('js-yaml')

let ok = args.length === 2

const commands = ['convert', 'run']
if (ok) ok = commands.includes(args[0])
// console.log(args)
if (!ok) return console.error(`
    PM+ - arguments required

    Some examples:
    - pm+ convert *.(json|yaml)  convert yaml from/to postman collection
    - pm+ run *.yaml             convert and run the postman via newman
`)

const isRun = args[0] === 'run'
, isConvert = args[0] === 'convert'
glob(args[1]).then(async f => {
    await f.reduce(async (p, f) => {
        await p
        if (isConvert && f.endsWith('.json')) return await loadJson(f)
        else if ((isConvert || isRun) && f.endsWith('.yaml')) return await loadYaml(f)
    }, Promise.resolve())
})

async function loadJson(fn) {
    let t = await readAsync(fn)
    try {
        const pm = JSON.parse(t)
        let ok = pm.info && pm.info.schema && pm.info.schema.indexOf('/v2.1.0/') > -1
        if (ok) ok = Array.isArray(pm.item) && pm.item.length
        if (ok) ok = pm.item[0].request || pm.item[0].item
        if (ok) {
            console.log('processing ...', fn)
            const dat = await fromPostman(pm)
            await writeAsync(`${fn.substr(0, fn.length - 5)}.yaml`, dat)
        }
        else console.error(fn, 'Expected Postman ver 2.1.0 collection')
    }
    catch (err) {
        console.error(fn, ':', err.message)
    }
}


async function loadYaml(fn) {
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

        await writeAsync(`${fn}.json`, JSON.stringify(pm, null, 2))
    }
    catch (err) {
        console.error(fn, ':', err.stack)
    }
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

    const VERBS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'TRACE']
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
    console.log('addevent', key, det[key] !== undefined)
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
        item.event.map(e => {
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
            [req.method]: req.url.raw,
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
    console.log('...', str)
    // support clear() to clear variables
    const m = rxSet.exec(str)
    if (!m || !m[1]) return

    const vars = m[1]
    vars.split(',').map(v => {
        if (!v) return
        const [k, val] = v.split('=').map(s => s.trim())
        if (isNumber(val)) obj[k] = +val
        else obj[k] = val
    })
    return true
}

const rxIncl = /include\(([A-Za-z,._\-0-9\ \/\=]*)\)/gm
async function processInclude(file, pm) {
// include(file, [step, step])
    console.log('...', file)
    const m = rxIncl.exec(file)
    if (!m) console.log('xxx', file)
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
console.log('Vars', vars)
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
  
// yaml supports:
// - include(filename, [steps]) in steps
// - file(filename) shorthand in body.formdata

// return loadYaml('test.yaml')
