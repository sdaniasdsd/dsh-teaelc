node -e "
const simDt=5e-6, sampleDt=2e-5, freq=60;
console.log('采样间隔='+(sampleDt*1e6)+'us, 采样率='+((1/sampleDt)/1000).toFixed(1)+'kHz');
console.log('60Hz 一周期='+(1000/freq).toFixed(1)+'ms, 每周期采样点='+((1/freq)/sampleDt).toFixed(0));
console.log('');
console.log('探头5 = 电源正极对地电位 = 正弦波(应为 120V 幅值)');
console.log('但读数写 -120.000V 且波形是直线 => 采样值恒为 -120');
console.log('说明采样点全部落在同一相位，或是 DC 分量');
console.log('');
console.log('检查：交流源的电压是否真的在变（内核 getVoltageDiff 实时读）');
"
