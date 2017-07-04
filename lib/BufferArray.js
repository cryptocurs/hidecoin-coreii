'use strict'

/* BufferArray
*  step - step in bytes
*  fields - array of {
*    name
*    size
*  }
*/

const R = require('ramda')

class BufferArray {

  constructor(options) {
    const {step, fields} = options
    
    this.options = options
    this.buffer = Buffer.allocUnsafeSlow(step)
    this.dataSize = 0
    this.length = 0
    
    this.fields = fields
    let start = 0
    this.itemSize = R.reduce((acc, field) => {
      field.start = start
      start += field.size
      return acc + field.size
    }, 0, R.values(this.fields))
    
    this.alloc = (stepsCount = 1) => {
      const _buffer = Buffer.allocUnsafeSlow(this.dataSize)
      this.buffer.copy(_buffer)
      this.buffer = Buffer.allocUnsafeSlow(this.buffer.length + step * stepsCount)
      _buffer.copy(this.buffer)
    }
    
    this.allocIfNeeded = () => {
      const resultSize = this.dataSize + this.itemSize
      const diff = resultSize - this.buffer.length
      if (diff > 0) {
        this.alloc(Math.ceil(diff / step))
      }
      return resultSize
    }
    
    this.allocForWhole = (length) => {
      this.alloc(Math.ceil((length - this.buffer.length) / step))
    }
    
    this.getValue = (data, field) => {
      if (field.type === 'number') {
        return data.readUIntBE(field.start, field.size)
      } else if (field.type === 'buffer') {
        return data.slice(field.start, field.start + field.size)
      }
    }
    
    this.writeData = (data, start) => {
      for (const name in this.fields) {
        const field = this.fields[name]
        const fieldData = data[name]
        if (field.type === 'number') {
          this.buffer.writeUIntBE(fieldData, start, field.size)
        } else if (field.type === 'buffer') {
          fieldData.copy(this.buffer, start, 0, field.size)
        }
        start += field.size
      }
    }
  }
  
  get(i) {
    const start = i * this.itemSize
    const end = start + this.itemSize
    if (end > this.dataSize) {
      return null
    }
    
    const data = this.buffer.slice(start, end)
    let res = {}
    for (const name in this.fields) {
      res[name] = this.getValue(data, this.fields[name])
    }
    return res
  }
  
  getField(i, name) {
    if (!this.fields[name]) {
      return null
    }
    
    const start = i * this.itemSize
    const end = start + this.itemSize
    if (end > this.dataSize) {
      return null
    }
    
    return this.getValue(this.buffer.slice(start, end), this.fields[name])
  }
  
  getWith(...args) {
    const index = this.indexOf(...args)
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
      const data = this.buffer.slice(pos, pos += this.itemSize)
      let res = {}
      for (const name in this.fields) {
        res[name] = this.getValue(data, this.fields[name])
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
    let pos = index * this.itemSize
    while (pos < this.dataSize) {
      const data = this.buffer.slice(pos, pos += this.itemSize)
      let res = {}
      for (const name in this.fields) {
        res[name] = this.getValue(data, this.fields[name])
      }
      const callbackResult = callback(res, i++, data)
      if (callbackResult !== undefined) {
        return callbackResult
      }
    }
    return returnDefault
  }
  
  rEach(callback, returnDefault = null) {
    let i = this.length - 1
    let pos = this.dataSize
    while (pos > 0) {
      const data = this.buffer.slice(pos - this.itemSize, pos)
      pos -= this.itemSize
      let res = {}
      for (const name in this.fields) {
        res[name] = this.getValue(data, this.fields[name])
      }
      const callbackResult = callback(res, i--, data)
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
        const data = this.buffer.slice(pos, pos += this.itemSize)
        let res = {}
        for (const name in this.fields) {
          res[name] = this.getValue(data, this.fields[name])
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
  
  rEachAsync(itemCallback, returnCallback) {
    let i = this.length
    let pos = this.dataSize
    const next = () => {
      if (i > 0) {
        const data = this.buffer.slice(pos - this.itemSize, pos)
        pos -= this.itemSize
        let res = {}
        for (const name in this.fields) {
          res[name] = this.getValue(data, this.fields[name])
        }
        itemCallback(res, --i, data, () => {
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
  
  indexOf(...args) {
    if (args.length === 1) {
      const [fields] = args
      return this.each((item, i) => {
        for (const fieldName in fields) {
          if (!R.equals(item[fieldName], fields[fieldName])) {
            return
          }
        }
        return i
      }, -1)
    } else if (args.length === 2) {
      const [fieldName, fieldValue] = args
      return this.each((item, i) => {
        if (R.equals(item[fieldName], fieldValue)) {
          return i
        }
      }, -1)
    } else {
      return -1
    }
  }
  
  push(data, i) {
    this.allocIfNeeded()
    let start
    if (i === undefined) {
      start = this.dataSize
    } else if (i < 0 || i > this.length) {
      return null
    } else {
      start = i * this.itemSize
      this.buffer.copy(this.buffer, start + this.itemSize, start)
    }
    this.writeData(data, start)
    this.dataSize += this.itemSize
    this.length++
    return this.buffer.slice(start, start + this.itemSize)
  }
  
  replace(i, data) {
    if (i < 0 || i >= this.length) {
      return null
    }
    
    const start = i * this.itemSize
    this.writeData(data, start)
    return this.buffer.slice(start, start + this.itemSize)
  }
  
  remove(i) {
    if (i < 0 || i >= this.length) {
      return false
    }
    
    const start = i * this.itemSize
    this.buffer.copy(this.buffer, start, start + this.itemSize)
    this.dataSize -= this.itemSize
    this.length--
    return true
  }
  
  clear() {
    this.dataSize = 0
    this.length = 0
    return true
  }
  
  filter(callback) {
    let dataSizeNew = 0
    let lengthNew = 0
    this.each((item, i, raw) => {
      if (callback(item)) {
        raw.copy(this.buffer, dataSizeNew)
        dataSizeNew += this.itemSize
        lengthNew++
      }
    })
    this.dataSize = dataSizeNew
    this.length = lengthNew
    return true
  }
  
  clone() {
    const bufferArray = new BufferArray(this.options)
    bufferArray.setWhole(this.getWhole())
    return bufferArray
  }
  
  setWhole(data) {
    this.allocForWhole(data.length)
    data.copy(this.buffer)
    this.dataSize = data.length
    this.length = parseInt(this.dataSize / this.itemSize)
    return true
  }
  
  getItemSize() {
    return this.itemSize
  }
  
  getSize() {
    return this.buffer.length
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
  return new BufferArray(options)
}