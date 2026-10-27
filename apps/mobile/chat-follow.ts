/** Only user-driven scrolling changes follow mode; content growth must not unpin it. */
export class ChatFollow {
 following=true;
 interacting=false;
 constructor(private readonly inverted=false){}
 scroll(offset:number,content:number,viewport:number){
  // Do not snap someone back after they deliberately scroll a few lines up.
  // Rejoin streaming only when they actually return to the bottom (rounding tolerance).
  if(this.interacting)this.following=this.inverted?offset<=8:content-viewport-offset<=8;
 }
 begin(){this.interacting=true;}
 end(){this.interacting=false;}
}
