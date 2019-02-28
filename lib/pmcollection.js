const yaml = require('js-yaml')
, fs = require('fs')
, { promisify } = require('util')
, readAsync = promisify(fs.readFile)
, writeAsync = promisify(fs.writeFile)

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
        let body = req.body.raw
        if (body) {
            if (isJsonContent(headers)) {
                req.body.raw = JSON.stringify(JSON.parse(body), null, 2)
            }
            else req.body.raw = body.replace(/[\r\t]/g, '  ')
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

    const out = {
        ...info,
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

function isJsonContent(headers) {
    const mime = 'application/json'
    return headers['content-type'] === mime
    || headers['Content-Type'] === mime
}

module.exports = {
    loadJson,
    isJsonContent
}