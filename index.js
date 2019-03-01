#!/usr/bin/env node

const { promisify } = require('util')
, arg = require('yargs').argv
, glob = require('tiny-glob')
, fs = require('fs')
, writeAsync = promisify(fs.writeFile)
, stdin = process.stdin

if (require.main === module) {
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

    go(arg.r || arg.run || arg.c || arg.convert, {
        domain: arg.u,
        exclude: arg.exclude,
        isConvert, isRun
    })
}

// exclude -> string | regexp
function go(pattern, { domain, isConvert, isRun, exclude }) {
    // console.log('run',{ pattern, domain, isConvert , isRun })
    const { loadJson, loadYaml } = require('./lib/pmcollection')
    const { run } = require('./lib/runner')

    glob(pattern).then(async f => {
        const fromYaml = []
        // return console.log(f.join('\n'))
        const files = await f.filter(r => {
            if (typeof exclude === 'string' && r.indexOf(exclude) > -1) return false
            else if (exclude instanceof RegExp && exclude.test(r)) return false
            return true
        }).reduce(async (p, f) => {
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

function convert(pattern) {
    return go(pattern, { isConvert: true })
}

function run(pattern, url) {
    return go(pattern, { isRun: true, domain: url })
}

async function curl2Yaml(curlCommand) {
    const { isJsonContent, makeYaml } = require(`${__dirname}/lib/pmcollection`)
    const curl = require('./lib/curl')
    const p = curl.parse(curlCommand)
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

    const dump = makeYaml({
        name: `From Curl`,
        steps: [{
            [`${p.method} ${p.path}`]: step
        }]
    })
    const fn = `curl_${+new Date()}.yaml`
    await writeAsync(fn, dump)
    console.log(`👍  ${fn} saved`)
}

module.exports = {
    curl2Yaml,
    convert,
    run    
}
// return loadYaml('test.yaml')

// ROADMAP
// - convert CURL to YAML https://github.com/tj/parse-curl.js
