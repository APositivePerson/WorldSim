// Serve the real built assets through Playwright routes, without opening network sockets.
const fs=require('node:fs/promises'),path=require('node:path');
module.exports=async function localAssets(page){
 await page.route('http://127.0.0.1:8080/**',async route=>{
  const url=new URL(route.request().url());let relative=decodeURIComponent(url.pathname);
  const root=path.resolve(__dirname,relative.startsWith('/human/')?'../character/public':'../web');
  relative=relative.startsWith('/human/')?relative.slice(7):relative.slice(1);
  if(!relative||relative.endsWith('/'))relative+='index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep))return route.fulfill({status:403});
  const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.xml':'text/xml','.glb':'model/gltf-binary','.css':'text/css'}[path.extname(file)]||'application/octet-stream';
  try{await route.fulfill({status:200,contentType:type,body:await fs.readFile(file)});}catch{await route.fulfill({status:404});}
 });
};
