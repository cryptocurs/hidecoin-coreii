'use strict'

const _ = require('lodash')

module.exports = new class Probable {

  calc(values) {
    let itemIndex
    while (values.length > 2) {
      const avg = _.mean(values)
      const min = _.min(values)
      const max = _.max(values)
      if ((min + max) / 2 === avg) {
        return avg
      }
      let maxDeviation = 0
      _.forEach(values, (value, i) => {
        const deviation = Math.abs(value - avg)
        if (deviation > maxDeviation) {
          maxDeviation = deviation
          itemIndex = i
        }
      })
      values.splice(itemIndex, 1)
    }
    return parseInt(_.mean(values))
  }
}