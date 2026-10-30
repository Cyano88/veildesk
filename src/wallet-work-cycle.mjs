// Run queued receipt work before optional maintenance. Receipt processing owns
// its fresh scan and moves the maintenance deadline forward after capture.
// Never overlap operations against the wallet's exclusive process lock.
export async function walletWorkCycle({tick,scanDue,scan,shouldStop=()=>false}){
 if(shouldStop())return;
 if(tick)await tick();
 if(shouldStop())return;
 if(scanDue())await scan();
}
