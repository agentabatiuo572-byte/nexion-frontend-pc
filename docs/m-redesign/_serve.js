const http=require("http"),fs=require("fs"),path=require("path");
const root=__dirname;
const TYPES={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css",".png":"image/png",".svg":"image/svg+xml"};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split("?")[0]);
  if(p==="/")p="/客服中心-M域-v1.html";
  const fp=path.join(root,p);
  if(!fp.startsWith(root)){res.writeHead(403);return res.end("no")}
  fs.readFile(fp,(e,d)=>{
    if(e){res.writeHead(404);return res.end("404")}
    res.writeHead(200,{"Content-Type":TYPES[path.extname(fp).toLowerCase()]||"application/octet-stream"});
    res.end(d);
  });
}).listen(8899,"127.0.0.1",()=>console.log("serving on http://127.0.0.1:8899"));
