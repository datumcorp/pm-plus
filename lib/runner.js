const chalk = require('chalk')
, glob = require('tiny-glob')
, pAll = require('p-all')
, _path = process.cwd()
, fs = require('fs')
, contentDisposition = require('content-disposition')

async function run(env, files) {
    let errors = { total: 0, files: [] }
    , cleanups = []

    if (!files?.length) return

    for await (let file of files) {
        if (file.endsWith('.pdir')) {
            // load folders specified
            // glob and loadYaml
            const parallels = await loadPdir(file)
            // console.log(`\n${chalk.bold.underline.whiteBright(`## ${file}`)}`)
            await pAll(parallels.map(async pdir => {                
                console.log(`\n${chalk.bold.underline.whiteBright(`##-> ${pdir.name}`)}`)
                // call nested run (env, subfiles)
                const pres = await run(env, pdir.files)
                cleanups.push(...pres.cleanups)
                errors.total += pres.errors.total
                errors.files.push(...pres.errors.files)
            }))
        }
        // we load collection using require
        // for better validation and handling
        let c = require(`${_path}/${file}`)
        // , name = ''
        // if (c && c.info) { name = c.info.name }
        console.log(`\n${chalk.bold.underline.whiteBright(`## ${file}`)}`)
        validate(c, file, _path)

        // run sequentially
        const res = await runTest({ collection: c, environment: env })
        errors.total += res.fails.length || 0
        errors.files.push({
            name: file,
            fails: res.fails,
            runs: res.runs,
            stats: res.stats,
            time: res.time,
            total: res.fails.length ? 1 : 0
        })
        
    }
    await new Promise(done => { setTimeout(() => done(), 300) })
    return { errors, cleanups }
}

// pdir = parallel directory
async function loadPdir(pdirFile) {
    const { loadYaml } = require('./lib/pmcollection')
    const parallels = []

    let t = await readAsync(pdirFile)
    try {
        const pdirs = JSON.parse(t)
        if (!Array.isArray(pdirs) || pdirs.length < 1) {
            throw Error(`Expected array of sub-directories`)
        }
        for await (let pd of pdirs) {
            const f = await glob('*.yaml')
            const files = await pAll(
                f.filter(r => {
                    // console.log(r)
                    if (typeof exclude === 'string' && r.indexOf(exclude) > -1) return false
                    else if (exclude instanceof RegExp && exclude.test(r)) return false
                    return true
                }).map(async file => await loadYaml(file))
            )
            parallels.push({ name: pd, files })
        }
    }
    catch (err) {
        console.error(pdirFile, err.stack)
    }

    return parallels
}

async function runTest({ collection, environment }) {
    const newman = require('newman')
    return new Promise(done => {
        newman.run({ collection, environment,
            // bail: true,
            ignoreRedirects: true,
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
        .on('request', function (error, args) {
            if (error) return

            const content = args.response.headers.reference['content-disposition'] || {}
            if (!content.value || !content.value.startsWith('attachment;')) return

            const disposition = contentDisposition.parse(content.value)

            fs.writeFile(`${slugify(args.item.name)}-${disposition.parameters.filename}`, args.response.stream, (error) => {
                if (error) console.error(error)
            })
        })
        .on('done', (error, summary) => {
            // console.info(`   ${err ? chalk.red('✖') : chalk.green('✓')}  ${collection.info.name}  ${err ? chalk.red(err.name) : ''}`)
            // console.error(summary.run.failures)
            // summary.run.failures.map(fail => {
            //     const e = fail.error
            //     if (!e.test && e.message) console.error('  ', chalk.yellow(e.message))
            // })
            const tm = summary.run.timings
            done({
                error, fails: summary.run.failures,
                time: tm.completed - tm.started,
                runs: summary.run.stats,
                stats: summary.run.executions.map(ex => {
                    const resp = ex.response || {}
                    return { name: ex.item.name, time: resp.responseTime, size: resp.responseSize }
                })
            })
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
                const fn = fdElem.src || fdElem.description
                const fpath = `${_path}/${fileWOExt}`
                let ffn = `${fpath}/${fn}`
                let mockFileExists = fs.existsSync(ffn)
                if (!mockFileExists && o.request?.srcdir) {
                    ffn = `${o.request.srcdir}/${fn}`
                    mockFileExists = fs.existsSync(ffn)
                }
                if (!mockFileExists) {
                    ffn = `${_path}/${fn}`
                    mockFileExists = fs.existsSync(ffn)
                }

                // Make folder for collection if it uses request body contains mock file
                // And mock file exit
                fdElem.enabled = false
                if (mockFileExists) {
                    console.log(' - found', fn)
                    fdElem.src = ffn
                    fdElem.enabled = true
                }
                else {
                    msg += `   - File not found: ${ffn}\n`;
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

const SLUGIFY_STRIP_RE = /[^a-zA-Z0-9\-\._]/g
const SLUGIFY_HYPHENATE_RE = /[-\s]+/g
function slugify(s) {
  s = s.replace(SLUGIFY_STRIP_RE, '').trim().toLowerCase()
  s = s.replace(SLUGIFY_HYPHENATE_RE, '-')
  return s
}

module.exports = {
    run
}