console.log('main.js running');
SystemJS.import('icojs').then(function(icojs) {
  console.log('icojs imported');
  console.log(icojs);
})
