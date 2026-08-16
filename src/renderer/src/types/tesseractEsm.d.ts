// src/renderer/src/types/tesseractEsm.d.ts
// tesseract.js 浏览器 ESM bundle（dist/tesseract.esm.min.js）的类型声明：
// 官方只给 CJS 主入口带类型，ESM bundle 无附带类型，这里桥接到官方命名空间类型

declare module 'tesseract.js/dist/tesseract.esm.min.js' {
  import Tesseract = require('tesseract.js')
  const tesseract: typeof Tesseract
  export = tesseract
}
