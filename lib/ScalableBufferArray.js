'use strict'

/* ScalableBufferArray
*  step - step in bytes
*  fields - array of {
*    name
*    size (may be undefined)
*  }
*/

const R = require('ramda')

class ScalableBufferArray {

  constructor(options) {
    const {step, fields} = options
    
    this.options = options
    this.buffer = Buffer.allocUnsafeSlow(step)
    this.customSizes = []
    this.dataSize = 0
    this.length = 0
    
    this.fields = fields
    this.itemMinSize = R.reduce((acc, field) => {
      return acc + (field.size || 0)
    }, 0, R.values(this.fields))
    
    this.calcItemSizesSum = (i) => {
      return this.itemMinSize * i + R.reduce((acc, sizes) => {
        return acc + R.reduce((acc, size) => {
          return acc + size
        }, 0, R.values(sizes))
      }, 0, this.customSizes.slice(0, i))
    }
    
    this.calcItemSize = (customSizes) => {
      return this.itemMinSize + R.reduce((acc, size) => {
        return acc + size
      }, 0, R.values(customSizes))
    }
    
    this.alloc = (stepsCount = 1) => {
      const _buffer = Buffer.allocUnsafeSlow(this.dataSize)
      this.buffer.copy(_buffer)
      this.buffer = Buffer.allocUnsafeSlow(this.buffer.length + step * stepsCount)
      _buffer.copy(this.buffer)
    }
    
    this.allocIfNeeded = (itemSize) => {
      const resultSize = this.dataSize + itemSize
      const diff = resultSize - this.buffer.length
      if (diff > 0) {
        this.alloc(Math.ceil(diff / step))
      }
      return resultSize
    }
    
    this.allocForWhole = (length) => {
      this.alloc(Math.ceil((length - this.buffer.length) / step))
    }
    
    this.getFieldStart = (i, name) => {
      const customSizes = this.customSizes[i]
      let start = 0
      for (const fieldName in this.fields) {
        if (fieldName === name) {
          return start
        }
        start += this.fields[fieldName].size || customSizes[fieldName]
      }
    }
    
    this.getFieldSize = (i, name) => {
      return this.fields[name].size || this.customSizes[i][name]
    }
    
    this.getValue = (data, i, name, type) => {
      const start = this.getFieldStart(i, name)
      const size = this.getFieldSize(i, name)
      if (type === 'number') {
        return data.readUIntBE(start, size)
      } else if (type === 'buffer') {
        return data.slice(start, start + size)
      }
    }
  }
  
  get(i) {
    const itemSize = this.calcItemSize(this.customSizes[i])
    const start = this.calcItemSizesSum(i)
    const end = start + itemSize
    if (end > this.dataSize) {
      return null
    }
    
    const data = this.buffer.slice(start, end)
    let res = {}
    for (const name in this.fields) {
      res[name] = this.getValue(data, i, name, this.fields[name].type)
    }
    return res
  }
  
  getField(i, name) {
    if (!this.fields[name]) {
      return null
    }
    
    const itemSize = this.calcItemSize(this.customSizes[i])
    const start = this.calcItemSizesSum(i)
    const end = start + itemSize
    if (end > this.dataSize) {
      return null
    }
    
    return this.getValue(this.buffer.slice(start, end), i, name, this.fields[name].type)
  }
  
  getWith(fieldName, fieldValue) {
    const index = this.indexOf(fieldName, fieldValue)
    if (index === -1) {
      return null
    } else {
      return this.get(index)
    }
  }
  
  each(callback, returnDefault = null) {
    let i = 0
    let pos = 0
    while (pos < this.dataSize) {
      const data = this.buffer.slice(pos, pos += this.calcItemSize(this.customSizes[i]))
      let res = {}
      for (const name in this.fields) {
        res[name] = this.getValue(data, i, name, this.fields[name].type)
      }
      const callbackResult = callback(res, i++, data)
      if (callbackResult !== undefined) {
        return callbackResult
      }
    }
    return returnDefault
  }
  
  eachFrom(index, callback, returnDefault = null) {
    let i = index
    let pos = this.calcItemSizesSum(index)
    while (pos < this.dataSize) {
      const data = this.buffer.slice(pos, pos += this.calcItemSize(this.customSizes[i]))
      let res = {}
      for (const name in this.fields) {
        res[name] = this.getValue(data, i, name, this.fields[name].type)
      }
      const callbackResult = callback(res, i++, data)
      if (callbackResult !== undefined) {
        return callbackResult
      }
    }
    return returnDefault
  }
  
  eachAsync(itemCallback, returnCallback) {
    let i = 0
    let pos = 0
    const next = () => {
      if (i < this.length) {
        const data = this.buffer.slice(pos, pos += this.calcItemSize(this.customSizes[i]))
        let res = {}
        for (const name in this.fields) {
          res[name] = this.getValue(data, i, name, this.fields[name].type)
        }
        itemCallback(res, i++, data, () => {
          setImmediate(() => {
            next()
          })
        })
      } else {
        returnCallback && returnCallback()
      }
    }
    
    next()
  }
  
  indexOf(fieldName, fieldValue) {
    return this.each((item, i) => {
      if (R.equals(item[fieldName], fieldValue)) {
        return i
      }
    }, -1)
  }
  
  push(data, customSizes, i) {
    const itemSize = this.calcItemSize(customSizes)
    
    this.allocIfNeeded(itemSize)
    let start
    if (i === undefined) {
      start = this.dataSize
    } else if (i < 0 || i > this.length) {
      return false
    } else {
      start = this.calcItemSizesSum(i)
      this.buffer.copy(this.buffer, start + itemSize, start)
    }
    this.customSizes = R.insert(i, customSizes, this.customSizes)
    for (const name in this.fields) {
      const field = this.fields[name]
      const fieldData = data[name]
      if (field.type === 'number') {
        this.buffer.writeUIntBE(fieldData, start, field.size || customSizes[name])
      } else if (field.type === 'buffer') {
        fieldData.copy(this.buffer, start, 0, field.size || customSizes[name])
      }
      start += field.size || customSizes[name]
    }
    this.dataSize += itemSize
    this.length++
    return true
  }
  
  remove(i) {
    if (i < 0 || i >= this.length) {
      return false
    }
    
    const itemSize = this.calcItemSize(this.customSizes[i])
    const start = this.calcItemSizesSum(i)
    this.buffer.copy(this.buffer, start, start + itemSize)
    this.customSizes = R.remove(i, 1, this.customSizes)
    this.dataSize -= itemSize
    this.length--
    return true
  }
  
  clear() {
    this.customSizes.length = 0
    this.dataSize = 0
    this.length = 0
    return true
  }
  
  filter(callback) {
    let customSizesNew = []
    let dataSizeNew = 0
    let lengthNew = 0
    this.each((item, i, raw) => {
      if (callback(item)) {
        const itemSize = this.calcItemSize(this.customSizes[i])
        raw.copy(this.buffer, dataSizeNew)
        customSizesNew.push(this.customSizes[i])
        dataSizeNew += itemSize
        lengthNew++
      }
    })
    this.customSizes = customSizesNew
    this.dataSize = dataSizeNew
    this.length = lengthNew
    return true
  }
  
  clone() {
    const bufferArray = new ScalableBufferArray(this.options)
    bufferArray.setWhole(this.getWhole(), this.customSizes)
    return bufferArray
  }
  
  setWhole(data, customSizes) {
    this.allocForWhole(data.length)
    data.copy(this.buffer)
    this.customSizes = customSizes
    this.dataSize = data.length
    this.length = customSizes.length
    return true
  }
  
  getSize() {
    return this.buffer.length
  }
  
  getCustomSizes() {
    return this.customSizes
  }
  
  getWhole() {
    return this.buffer.slice(0, this.dataSize)
  }
  
  getRaw() {
    return this.buffer
  }
  
  getLength() {
    return this.length
  }
}

module.exports = (options) => {
  return new ScalableBufferArray(options)
}