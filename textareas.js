// -*- tab-width:2; indent-tabs-mode:t -*- vim: set noet ts=2:
/*
 * TextAreas.js
 *
 * This "content" script finds TextArea's in the DOM and tags them
 * with a unique ID and edit button. When the button is
 * clicked it communicates with the master extension page to send an
 * edit request.
 *
 * This file is part of emacs_chrome (http://github.com/stsquad/emacs_chrome)
 * and licensed under the GPLv3. See the COPYING file for details
 */
 
var editImgURL = chrome.extension.getURL("gumdrop.png");
var port = chrome.extension.connect();
var page_edit_id = 0;
var pageTextAreas = [];
var findingTextAreas = false;
var animating = false;

// via options
var enable_button = true;
var enable_dblclick = false;
var enable_keys = false;

/*
	getTitle

	Get the title from the DOM, if that fails try to synthesise something sensible
*/

function getTitle()
{
	var title = document.title;
	if (title == null || title.length==0) {
		try {
			title = document.getElementsByTagName('title').item().innerText;
		} catch (err) {
			console.log ("failed to extract title from HTML ("+err+")");
			title = document.documentURI;
		}
	}
	return title;
}

/*
	textAreaTracker

	This object wraps up all the information about a given text area on the page.
	It allows us to update the listeners and query stuff from one central location.
*/

function textAreaTracker(text)
{
	this.edit_id = "eta_"+page_edit_id;
	page_edit_id = page_edit_id + 1;
	this.text = text;
	this.text.setAttribute("edit_id", this.edit_id);

	// The text areas event handlers we attach
	this.focusListener = setFocused;
	this.dblclickListener = function(){sendTextArea(this);};
	this.keydownListener = function (e) {
		// Alt-Enter
		if (e.altKey && e.keyCode == 13)
			sendTextArea(this);
	};
	
	this.text.addEventListener('focus',  this.focusListener);

	if (enable_dblclick)
		this.text.addEventListener('dblclick', this.dblclickListener);
	if (enable_keys)
		this.text.addEventListener('keydown', this.keydownListener);

	// The img 
	if (enable_button) {
		this.image = document.createElement('img');
		this.image.style.cursor='pointer';
		this.image.setAttribute("edit_id", this.edit_id);
		this.image.src = editImgURL;

		this.clickListener = editTextArea;
		this.image.addEventListener('click', this.clickListener, false);

		this.text.parentNode.insertBefore(this.image, text.nextSibling);
	}

}

/*
	getTextAreaTracker

	Fetch the appropriate textAreaTracker for the given ID. As it tracks each element we
	care about it's probably worth going through this short array rather than iterating
	the entire DOM every time
*/
	
function getTextAreaTracker(search_id)
{
	for (var i=0; i<pageTextAreas.length; i++) {
		if (pageTextAreas[i].edit_id == search_id)
			return pageTextAreas[i];
	}

	return null;
}
	
/*
	tagTextArea

	Any textarea we edit needs to be tagged with a unique ID so
	when the get the edit response we know what to fill in. This
	gets called several times not least as some text boxes can
	appear in the document after first load.
*/
function tagTextArea(text)
{
	// We don't want to tag all text boxen, especially if they are hidden
	var display = text.style.getPropertyCSSValue('display');
	if (display && display.cssText=="none")
	{
		return;
	}

	// If spellcheck is turned off, usually it's just for quick editing, e.g. To: fields in gmail
	var spellcheck = text.getAttribute("spellcheck");
	if (spellcheck && spellcheck == "false")
		return;

	var existing_id = text.getAttribute("edit_id");
	if (!existing_id)
	{
		// tag it
		pageTextAreas.push(new textAreaTracker(text));
	} else {
		// Even though this text has an edit_id it might not actually be the
		// text we think it is. If the textAreaTracker.text doesn't match then
		// we should tag this with something different

		var existing_area = getTextAreaTracker(existing_id);
		if ( existing_area &&
			 (existing_area.text != text ) )
		{
			console.log("tagTextArea: Working around a duplicate id!");
			// OK, first things first, find any images that think
			// they are associated with a text area and remove them
			siblings = text.parentElement.childNodes;

			for (var j=0; j<siblings.length; j++) {
				if (! (siblings[j].getAttribute == undefined) ) {
					if ( (siblings[j].getAttribute("edit_id") == existing_area.edit_id) &&
						 (siblings[j].toString() == "[object HTMLImageElement]") ) {
						siblings[j].parentElement.removeChild(siblings[j]);
					}
				}
			}
				
			// And create a new tracked text area
			pageTextAreas.push(new textAreaTracker(text));
		}
	}
}
	

/*
 updateTextArea

 Called when we want to update the text area with our updated text
*/
function updateTextArea(id, content) {
	var tracker = getTextAreaTracker(id);
	if (tracker) {
		tracker.text.value = content;
		// mark node as changed
		var event = document.createEvent("HTMLEvents");
		event.initEvent('change', true, false);
		tracker.text.dispatchEvent(event);

		if (!animating) {
			animating = true;
			orig = $(tracker.text).css('background-color');
			$(tracker.text).css({'background-color': 'yellow'});
			setTimeout(function(){
				$(tracker.text).animate({ 'background-color': orig }, 1000, null,
																function(){ animating = false; });
			}, 1000);
		}
	}
}

/*
	sendTextArea

	Send the text area to the main part of the extension to be passed
	on to the external editor. Eventually 
*/

function sendTextArea(text) {
	var text_edit_id = text.getAttribute("edit_id");
	// And spawn the request
	var edit_msg = {
		msg: "edit",
		text: text.value,
		title: getTitle(),
		id: text_edit_id
	};
	port.postMessage(edit_msg);
}

/*
	Handle focused text area
*/
(function(){
	 var focusedEdit = null;

	 findActiveTextArea = function() {
		 if (focusedEdit) {
			 sendTextArea(focusedEdit);
		 } else {
			 var msg_text = "No textarea in focus in: "+getTitle();
			 port.postMessage( {msg: "error", text: msg_text} );
		 }
	 };

	 setFocused = function(){
		 focusedEdit = this;
		 // Update UI?
		 var id = this.getAttribute("edit_id");
		 if (id != undefined) {
			 port.postMessage( {msg: "focus", id: id} );
			 this.addEventListener('blur',	function() {
					 port.postMessage( {msg: "focus", id: null} );
					 this.removeEventListener('blur',arguments.callee,false);
				 });
		 }
	 };
 })();

/*
 editTextArea

 Called when the edit button on a page is clicked, once done
 it finds the appropriate text area, extracts it's text and
 fires a message to the main extension to trigger the editing
*/
 
function editTextArea(event) {
	var img = event.currentTarget;
	var edit_id = img.getAttribute("edit_id");

	var tracker = getTextAreaTracker(edit_id);
	if (tracker) {
		sendTextArea(tracker.text);
	}
}

/*
	This is the main find function for searching for TEXTAREAS. It protects itself via
	a (page) global semaphore called findingTextAreas so it doesn't call itself after
	tagTextArea() adds new nodes to the DOM tree.
*/
function findTextAreasIn(thing) {

	// Whatever thing is it need to have the getElementsByTagName method
	// or there isn't a lot we can do about it.
	if (!thing.getElementsByTagName)
		return;
	
	// Don't run through this if already finding stuff, lest we trigger events
	if (findingTextAreas)
		return;

	findingTextAreas = true;
	
	try {
		var texts = thing.getElementsByTagName('textarea');
		for (var i=0; i<texts.length; i++) {
			tagTextArea(texts[i]);
		}
	} catch (err) {
		// it seems some (I)FRAMES have undefined contentDocuments
		console.log("findTextAreasIn: failed with "+err);
	}

	findingTextAreas = false;
}

/*
	Exhaustively search the page for textareas.
*/
function findTextAreas() {

	// The main document
	findTextAreasIn(document);

	// IFRAMEs
	var iframes = document.getElementsByTagName('iframe');
	for (i = 0; i < iframes.length; i++) {
		findTextAreasIn(iframes[i].contentDocument);
	}

	// FRAMEs
	var frames = document.getElementsByTagName('frame');
	for (i = 0; i < frames.length; i++) {
		findTextAreasIn(frames[i].contentDocument);
	}

	return true;
}

/* Message handling multiplexer */
function localMessageHandler(msg, port) {
	// What was the bidding?
	var cmd = msg.msg;
	if (cmd == "config") {
		console.log("config response: "+msg);
		enable_button = msg.enable_button;
		enable_dblclick = msg.enable_dblclick;
		enable_keys = msg.enable_keys;
		findTextAreas();
		document.addEventListener("DOMNodeInserted", (function (ev) {
					findTextAreas();
					return true;
				}), false);
	} else if (cmd == "find_edit") {
		findActiveTextArea();
	} else if (cmd == "update") {
		var id = msg.id;
		var content = msg.text;
		updateTextArea(id, content);
	} else {
		console.log("localMessageHandler: un-handled message:"+cmd);
	}
}

// Hook up the incoming message handler for both return messages
// as well as direct messages from main extension.

port.onMessage.addListener(localMessageHandler);
chrome.extension.onConnect.addListener(function(iport) {
		iport.onMessage.addListener(localMessageHandler);
	});

/*
	To start the whole process off we first need to fetch our configuration
	from the background process.
*/
port.postMessage({msg: "config"});


// Inform the background process whenever the user opens
// the context menu on an editable element.
document.addEventListener("contextmenu", (function(event) {

	var elem = event.srcElement;
	if (elem && elem.getAttribute("edit_id")) {
	var request = {
		type: "menu_target",
		edit_msg: {
		msg: "edit",
		text: elem.value,
		title: getTitle(),
		id: elem.getAttribute("edit_id")
		}
	};
	chrome.extension.sendRequest(request);
	}

}));
