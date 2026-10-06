// Galaxy HUD, form and detail markup (ported from Goal Galaxy.html).
// Dynamic text is filled in with textContent by engine.js, never interpolated here.
export const MARKUP = `
<div id="stage"></div>

<div class="hud">
  <div>
    <h1>Goal Galaxy</h1>
    <div class="sub">tap a planet · tap a rift to visit a friend · drag to rotate · double-tap to reset</div>
  </div>
  <div class="btns">
    <button id="addBtn">+ New Goal</button>
    <div class="row">
      <button class="pill" id="socialBtn" title="Find people and manage connections">👥 Connections<span class="badge" id="socialBadge"></span></button>
      <button class="pill" id="mvBtn" title="Goals you share with others">🌀 Multiverse<span class="badge" id="mvBadge"></span></button>
      <button class="pill" id="allBtn" title="Show every solar system" style="display:none">🌌 all</button>
      <button class="pill" id="orbitBtn" title="Pause or resume orbits">⏸ orbit</button>
      <button class="pill" id="viewBtn" title="Back to your solar system">⟲ view</button>
      <button class="pill" id="moreBtn" title="Sound, screenshots, sharing, notifications">☰ More</button>
    </div>
    <div class="row">
      <span class="savestat" id="saveStatus"></span>
      <span class="pill who" id="whoPill"></span>
      <button class="pill" id="logoutBtn" title="Log out">Log out</button>
    </div>
  </div>
</div>

<div class="legend">
  <span><i class="dot" style="background:var(--high)"></i>High</span>
  <span><i class="dot" style="background:var(--med)"></i>Medium</span>
  <span><i class="dot" style="background:var(--low)"></i>Not necessary</span>
  <span><i class="dot" style="border:2px solid var(--done)"></i>Done</span>
  <span><i class="dot" style="border:1px dashed var(--dim)"></i>Not done</span>
  <span><i class="dot" style="box-shadow:0 0 0 2px #ff4d4d"></i>Overdue</span>
</div>
<div class="ringlabels">
  <div>inner ring — next 12 months</div>
  <div>middle ring — next 5 years</div>
  <div>outer ring — next 15 years</div>
  <div>dashed part of each ring — past · later</div>
</div>

<div class="overlay" id="formOverlay">
  <div class="card">
    <h2 id="formTitle">New Goal</h2>
    <div class="field">
      <label for="goalName">Goal</label>
      <input type="text" id="goalName" placeholder="e.g. Learn Spanish">
    </div>
    <div class="field">
      <label for="goalCategory">Category</label>
      <input type="text" id="goalCategory" placeholder="e.g. Career, Health, Finance">
    </div>
    <div class="field">
      <label for="goalDate">Target date</label>
      <input type="date" id="goalDate">
    </div>
    <div class="field">
      <label>Importance</label>
      <div class="seg" id="segImportance">
        <button data-v="high">High</button>
        <button data-v="medium">Medium</button>
        <button data-v="low">Not necessary</button>
      </div>
    </div>
    <div class="field" id="tfField">
      <label>Timeframe</label>
      <div class="seg" id="segTime">
        <button data-v="short">Short</button>
        <button data-v="mid">Mid</button>
        <button data-v="long">Long</button>
      </div>
      <div class="hint" id="tfHint"></div>
    </div>
    <div class="field">
      <label>Status</label>
      <div class="seg" id="segStatus">
        <button data-v="ongoing">Ongoing</button>
        <button data-v="done">Done</button>
        <button data-v="notdone">Not done</button>
      </div>
    </div>
    <div class="field" id="whyField">
      <label for="goalWhy">Why it matters <span class="lbl-sub">you'll see this if it slips</span></label>
      <input type="text" id="goalWhy" maxlength="500" placeholder="e.g. So I can travel on my own">
    </div>
    <div class="field" id="privacyField">
      <label>Who can see it</label>
      <div class="seg" id="segPrivacy">
        <button data-v="shared">Connections</button>
        <button data-v="chosen">Chosen people</button>
        <button data-v="private">Only me 🔒</button>
      </div>
      <div class="sharepick" id="sharePick"></div>
    </div>
    <div class="field">
      <label>Notes</label>
      <div class="rte">
        <div class="rte-bar" id="rteBar">
          <button type="button" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
          <button type="button" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
          <button type="button" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
          <button type="button" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
          <span class="sep"></span>
          <button type="button" data-cmd="heading" title="Heading">H</button>
          <button type="button" data-cmd="insertUnorderedList" title="Bullet list">• ≡</button>
          <button type="button" data-cmd="insertOrderedList" title="Numbered list">1 ≡</button>
          <button type="button" data-cmd="quote" title="Quote">❝</button>
          <span class="sep"></span>
          <button type="button" data-cmd="link" title="Link (Ctrl+K)">🔗</button>
          <button type="button" data-cmd="removeFormat" title="Clear formatting">⌫</button>
        </div>
        <div class="rte-link" id="rteLink">
          <input type="text" id="rteLinkInput" placeholder="Paste a link, then press Enter">
          <button type="button" id="rteLinkOk">Add</button>
          <button type="button" class="ghost" id="rteUnlink">Remove</button>
        </div>
        <div class="rte-body rich" id="goalNotes" contenteditable="true" spellcheck="true"
             data-placeholder="Why this goal matters, steps, progress…"></div>
      </div>
      <div class="hint" id="notesHint"></div>
    </div>
    <div class="hint" id="formApprovalHint"></div>
    <div class="actions">
      <button class="cancel" id="cancelBtn">Cancel</button>
      <button class="save" id="saveBtn">Save</button>
    </div>
  </div>
</div>

<div class="overlay" id="detailOverlay">
  <div class="card detail">
    <button class="xbtn" id="dX" aria-label="Close">×</button>
    <p class="owner" id="dOwner"></p>
    <div class="name" id="dName"></div>
    <p id="dCategory"></p>
    <p id="dImportance"></p>
    <p id="dTimeframe"></p>
    <p id="dDate"></p>
    <p id="dStatus"></p>
    <p id="dPrivacy"></p>
    <p class="note" id="dNote"></p>
    <div class="notes-view rich" id="dNotes" title="Click to edit notes"></div>
    <div class="dextras" id="dExtras"></div>
    <div class="actions">
      <button class="cancel" id="dClose">Close</button>
      <button class="save" id="dEdit">Edit</button>
      <button class="del" id="dDelete">Delete</button>
    </div>
  </div>
</div>

<div class="overlay" id="socialOverlay">
  <div class="card social">
    <button class="xbtn" id="sX" aria-label="Close">×</button>
    <h2>Connections</h2>
    <div class="field">
      <label for="sEmail">Find someone by their exact email</label>
      <div class="srow">
        <input type="email" id="sEmail" placeholder="friend@example.com" autocomplete="off" spellcheck="false">
        <button class="sbtn" id="sFind">Find</button>
      </div>
      <div class="sresult" id="sResult"></div>
    </div>
    <div class="ssec" id="sIncomingSec"><h3>Requests for you</h3><div id="sIncoming"></div></div>
    <div class="ssec" id="sOutgoingSec"><h3>Waiting for a reply</h3><div id="sOutgoing"></div></div>
    <div class="ssec"><h3>Connected</h3><div id="sFriends"></div></div>
    <div class="ssec"><h3>Groups <span class="lbl-sub">a group's rifts sit together as a cluster</span></h3><div id="sGroups"></div></div>
    <p class="shint">Connected people see each other's solar systems. Goals set to "Only me" are never shown.</p>
  </div>
</div>

<div class="overlay" id="mvOverlay">
  <div class="card social">
    <button class="xbtn" id="mvX" aria-label="Close">×</button>
    <h2>Multiverse</h2>
    <p class="shint" style="margin:0 0 6px">A multiverse is one goal you work on together with up to 4 connections. Everyone can edit; the creator approves changes.</p>
    <p class="shint" style="margin:0 0 6px">✨ Shortcut: hold your sun, then drag to your friends' suns. To accept an invitation, hold its glowing portal.</p>
    <div class="ssec" id="mvInvitesSec"><h3>Invitations</h3><div id="mvInvites"></div></div>
    <div class="ssec"><h3>Your multiverses</h3><div id="mvList"></div></div>
    <div class="actions"><button class="save" id="mvNewBtn">+ Create a multiverse</button></div>
  </div>
</div>

<div class="overlay" id="mvCreateOverlay">
  <div class="card">
    <button class="xbtn" id="mcX" aria-label="Close">×</button>
    <h2>New multiverse</h2>
    <div class="field">
      <label for="mcName">Shared goal</label>
      <input type="text" id="mcName" placeholder="e.g. Run a marathon together">
    </div>
    <div class="field">
      <label for="mcCategory">Category</label>
      <input type="text" id="mcCategory" placeholder="e.g. Health, Travel, Business">
    </div>
    <div class="field">
      <label for="mcDate">Target date</label>
      <input type="date" id="mcDate">
    </div>
    <div class="field">
      <label>Importance</label>
      <div class="seg" id="mcImp">
        <button data-v="high">High</button>
        <button data-v="medium">Medium</button>
        <button data-v="low">Not necessary</button>
      </div>
    </div>
    <div class="field">
      <label>Milestones <span class="lbl-sub">each one becomes a band on the shared planet</span></label>
      <div id="mcMilestones"></div>
      <button type="button" class="linkbtn" id="mcAddMs" style="margin-top:6px">+ Add milestone</button>
    </div>
    <div class="field">
      <label>Invite <span class="lbl-sub" id="mcInviteCount"></span></label>
      <div id="mcInvite"></div>
    </div>
    <div class="hint" id="mcHint"></div>
    <div class="actions">
      <button class="cancel" id="mcCancel">Cancel</button>
      <button class="save" id="mcCreate">Create</button>
    </div>
  </div>
</div>

<div class="mvhud" id="mvHud">
  <div>
    <div class="mvkicker">🌀 Multiverse</div>
    <h1 id="mvTitle"></h1>
    <div class="sub">tap a moon to nudge · double-tap a band to cheer · tap a light in the spiral for history · double-tap space to reset</div>
  </div>
  <div class="row">
    <button class="pill" id="mvView" title="Reset camera">⟲ view</button>
    <button class="pill" id="mvBack" title="Back to your galaxy">← Galaxy</button>
  </div>
</div>
<div class="mvhud visithud" id="visitHud">
  <div>
    <div class="mvkicker">👀 Visiting</div>
    <h1 id="visitTitle"></h1>
    <div class="sub">tap a planet for details · the ⌂ Home rift or ← Galaxy takes you home</div>
  </div>
  <div class="row">
    <button class="pill" id="visitView" title="Reset camera">⟲ view</button>
    <button class="pill" id="visitBack" title="Back to your galaxy">← Galaxy</button>
  </div>
</div>
<div class="mvpanel" id="mvPanel"></div>
<div class="warp" id="warp"></div>
<div class="bangflash" id="bangFlash"></div>
<div class="holdring" id="holdRing"><svg viewBox="0 0 56 56"><circle class="bg" cx="28" cy="28" r="22"/><circle class="arc" cx="28" cy="28" r="22"/></svg></div>
<div class="casthint" id="castHint"></div>

<div class="overlay" id="moreOverlay">
  <div class="card social">
    <button class="xbtn" id="moreX" aria-label="Close">×</button>
    <h2>More</h2>
    <div id="moreList"></div>
  </div>
</div>

<div class="shotbar" id="shotBar">
  <button id="shotTake">📷 Save picture</button>
  <button class="ghost" id="shotLabels">Labels: off</button>
  <button class="ghost" id="shotExit">Done</button>
</div>

<div class="robanner" id="roBanner"><span id="roName"></span><a href="/signup">Make your own ✨</a></div>

<div class="toast" id="toast"><span id="toastMsg"></span><button id="toastAction"></button><button class="tx" id="toastX">×</button></div>
<div id="bootError"></div>
`;
