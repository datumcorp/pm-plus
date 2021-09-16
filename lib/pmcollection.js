const yaml = require('js-yaml')
, fs = require('fs')
, path = require('path')
, { promisify } = require('util')
, readAsync = promisify(fs.readFile)
, existsAsync = promisify(fs.exists)
, writeAsync = promisify(fs.writeFile)
, rxEscToken = /:\s*(\{\{[a-zA-Z0-9]*\}\}),/gm
, rxEscToken2 = /"<(\{\{[a-zA-Z0-9]*\}\})>"/gm


function pm2yaml(dat, nested = false) {
    const info = dat.info || {}
    delete info._postman_id
    delete info.schema

    const steps = []
    dat.item.map(item => {
        if (Array.isArray(item.item)) {
            // handle folder
            // console.log('folder', item)
            steps.push(...pm2yaml(item, true))
            return
        }
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

        const headers = (req.header || []).reduce((p, c) => {
            p[c.key] = c.value
            return p
        }, {})

        if (req.body && req.body.mode) delete req.body.mode
        const fdata = (req.body || {}).formdata || {}
        let body = (req.body || {}).raw
        if (body) {
            if (isJsonContent(headers)) {
                try {
                    // escape {{token}} -> "<{{token}}>"
                    body = body.replace(rxEscToken, (x, y) => `: "<${y}>",`)
                    const t = JSON.stringify(JSON.parse(body), null, 2)
                    // revert "<{{token}}>" -> {{token}}
                    body = t.replace(rxEscToken2, (x, y) => y)
                }
                catch(err) {
                    // error is expected when using variables {{xx}} inside json
                    // console.error('pm2yaml', err.message)
                    // console.error('>>', body)
                    req.body.raw = body
                }
            }
            req.body.raw = body.replace(/\r/g, '').replace(/\t/g, '  ')
        }
        else if (Array.isArray(fdata)) {
            // remove empty formdata entries
            req.body.formdata = fdata.filter(r => r.key.length)
        }

        const { prerequest, test } = evt
        let url = req.url.raw || req.url
        try {
            url = decodeURIComponent(url)
        }
        catch {}
        o[item.name] = {
            [req.method]: url,
            headers,
            prerequest, // force prerequest order before test
            body: req.body,
            test,
            ...item
        }

        if (Array.isArray(req.url.variable)) {
            const urlvars = {}
            req.url.variable.map(o => {
                urlvars[o.key] = o.value
            })
            o[item.name].urlvars = urlvars
        }

        if (o[item.name].prerequest === undefined) delete o[item.name].prerequest
        if (o[item.name].test === undefined) delete o[item.name].test
        delete o[item.name].name
        delete o[item.name].response
        steps.push(o)
    })

    if (nested) return steps
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

        if (!dat.steps) throw Error('No steps found!')
        dat.steps.map(step => {
            if (typeof step === 'string') {
                if (setVars(step, vars)) return
                // include(file, [step, step])
                return processInclude(step, pm, fn)
            }
            makeStep(step, pm, vars, fn)
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

function makeStep(step, pm, vars, basefile) {
    const det = Object.values(step)[0]
    , stepname = Object.keys(step)[0]
    det.body = det.body || {}

    if (typeof det.body !== 'object') {
        throw Error(`In [${stepname}]: 'body' not object ${det.body}`)
    }
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
        header: Object.keys(det.headers || {}).map(key => ({
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
    let prescript = ''
    , incl = det.include
    if (incl) {
        if (typeof incl === 'string') incl = incl.split(',')
        prescript = includeScripts(incl, basefile)
        // can be string or array of strings
        // path to js files
    }

    const event = []
    addEvent('prerequest', event, det, prescript)
    addEvent('test', event, det, prescript)
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
            path: url.slice(1),
            variable: Object.keys(det.urlvars || {}).map(k => ({ key: k, value: det.urlvars[k] }))
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

function includeScripts(files, basefile) {
    const p = path.dirname(basefile)
    return files.map(f => {
        //if (!f.startsWith('/') && !f.startsWith('./')) f = `./${f}`
        f = path.join(p, f)
        if (!fs.existsSync(f)) return ''
        console.log('...', f)
        return fs.readFileSync(f).toString()
    }).join(';\n') + (files.length ? ';\n' : '')
}

function addEvent(key, events, det, prescript) {
    // console.log('addevent', key, det[key] !== undefined)
    if (!det[key] && !prescript) return
    events.push({
        listen: key,
        script: {
            exec: [...prescript.split('\n'), ...(det[key] || '').split('\n')],
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
    makeYaml,
    makeStep
}