'use strict'

const R = require('ramda')

module.exports = new class Asyncs {

  // for (increment), min - including, max - not including
  forInc(min, max, itemCallback, returnCallback) {
    let i = min
    const next = () => {
      itemCallback(i, () => {
        ++i < max && setImmediate(next) || returnCallback && returnCallback()
      })
      return true
    }
    i < max && next() || returnCallback && returnCallback()
  }
  
  forEach(obj, itemCallback, returnCallback) {
    if (obj instanceof Array) {
      this.forInc(0, obj.length, (i, next) => {
        itemCallback(obj[i], i, next)
      }, returnCallback)
    } else {
      const keys = R.keys(obj)
      this.forInc(0, keys.length, (i, next) => {
        itemCallback(obj[keys[i]], keys[i], next)
      }, returnCallback)
    }
  }
}