const http = require('http');
http.get('http://127.0.0.1:8000/api/load', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(JSON.stringify(JSON.parse(data).parsed.surfaces, null, 2));
  });
}).on("error", (err) => {
  console.log("Error: " + err.message);
});
