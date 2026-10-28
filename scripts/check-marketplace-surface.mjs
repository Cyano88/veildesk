import {checkMarketplaceSurface} from '../src/marketplace-surface.mjs';
const report=await checkMarketplaceSurface();
console.log(JSON.stringify(report,null,2));
process.exitCode=report.publicIntegrationSurfaceReady?0:1;
