(function(root){
  "use strict";
  function scene(inspection,state={}){
    const recording=!!state.recording,status=String(inspection?.status||""),replay=status==="6";
    return {name:recording?"recording":replay?"replay":"live",recording,replay,
      importable:!!inspection&&!recording&&!state.pending&&!["1","2","3","5","9"].includes(status),
      title:recording?"正在听课":replay?"课后整理":"当前课时",
      startLabel:replay?"播放时显示实时字幕":"开始实时字幕",
      hint:recording?"字幕与提醒持续保存在本机。":replay?"优先读取学校字幕；没有字幕时在本机转写。":inspection?"播放课程后开始，只识别当前标签页的声音。":"请先打开一节课的学校播放页。"};
  }
  const api={scene};if(typeof module!=="undefined"&&module.exports)module.exports=api;root.PopupState=api;
})(globalThis);
