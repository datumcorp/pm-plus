function isNumber(n) {
    return !isNaN(parseFloat(n)) && isFinite(n)
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

module.exports = {
    processInclude,
    clearVars,
    setVars
}