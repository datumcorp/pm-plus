const yaml = require('js-yaml')
, fs = require('fs')
, { promisify } = require('util')
, readAsync = promisify(fs.readFile)
, existsAsync = promisify(fs.exists)
, writeAsync = promisify(fs.writeFile)
, rxEscToken = /:\s*(\{\{[a-zA-Z0-9]*\}\}),/gm
, rxEscToken2 = /"<(\{\{[a-zA-Z0-9]*\}\})>"/gm
async function pm2yaml(dat) {
    const info = dat.info
    delete info._postman_id
    delete info.schema

    const steps = []
    dat.item.map(item => {
        // TODO: handle folder
        const evt = {}
        if (item.event) item.event.map(e => {
            const s = e.script.exec.join('\n').replace(/\r/g, '').replace(/\t/g, '  ')
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
        let body = req.body.raw
        if (body) {
            if (isJsonContent(headers)) {
                try {
                    // escape {{token}} -> "<{{token}}>"
                    body = body.replace(rxEscToken, (x, y) => `: "<${y}>",`)
                    req.body.raw = JSON.stringify(JSON.parse(body), null, 2)
                    // revert "<{{token}}>" -> {{token}}
                    req.body.raw = req.body.raw.replace(rxEscToken2, (x, y) => y)
                }
                catch(err) {
                    req.body.raw = body
                }
            }
            req.body.raw = body.replace(/\r/g, '').replace(/\t/g, '  ')
        }
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

    return makeYaml({ ...info, steps })
}

function makeYaml({ name, description, steps }) {
    
    const out = {
        name,
        description: description || '',
        ver: '1.0.0',
        steps
    }
    return yaml.dump(out)
}

const rxSchema = /\/v2.[0-9].0\/collection.json/g
async function loadJson(fn) {
    let t = await readAsync(fn)
    try {
        const pm = JSON.parse(t)
        let ok = pm.info && pm.info.schema && rxSchema.test(pm.info.schema)
        if (ok) ok = Array.isArray(pm.item) && pm.item.length
        if (ok) ok = pm.item[0].request || pm.item[0].item
        if (ok) {
            const dat = await pm2yaml(pm)
            const newfn = `${fn.substr(0, fn.length - 5)}.yaml`
            await writeAsync(newfn, dat)
            console.log(`👍  ${newfn} saved`)
        }
        else console.error(fn, 'Expected Postman ver 2.1.0 collection')
    }
    catch (err) {
        console.error(fn, err.stack)
    }
}

async function loadYaml(fn, isRun) {
    const { processInclude, setVars } = require('./macros')
    let t = await readAsync(fn)
    try {
        const dat = yaml.load(t)
        , { name, description } = dat
        , pm = {
            info: {
                name,
                description,
                schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
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

        // const fn2 = `${isRun ? `${fn}_${+new Date()}` : fn.substr(0, fn.length - 5)}.json`
        let fn2 = `${fn.substr(0, fn.length - 5)}.json`
        if (await existsAsync(fn2))
            fn2 = `${fn.substr(0, fn.length - 5)}_${+new Date()}.json`

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
    det.body = det.body || {}
    const fdata = det.body.formdata

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
    // console.log('>>', name)
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

function isJsonContent(headers) {
    const mime = 'application/json'
    return headers['content-type'] === mime
    || headers['Content-Type'] === mime
}

module.exports = {
    loadJson,
    loadYaml,
    isJsonContent,
    makeYaml
}