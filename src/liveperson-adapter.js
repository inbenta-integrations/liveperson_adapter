// Get availability from LivePerson
let getAvailability = function() {
    let url = livePerson.chatUrl + '/availability?v=1&NC=true';
    let headers = {
        'Authorization': 'LivePerson appKey=' + livePerson.appKey
    };
    return makeAPIRequest('GET', url, null, headers);
}

// Promise for agent availability (for SDKNLEscalation2())
let inbentaPromiseAgentsAvailableTrue = function () {
    return new Promise(function (resolve, reject) {
        getAvailability().then(function(data) {
            data.json().then(function(data) {
                resolve({'agentsAvailable': data.availability});
            }).catch(error => console.error('Error: ', error))
        });
    });
}

// Send the request to LivePerson API (to get availability, send user data and transcript)
function makeAPIRequest(method, url, body, headers) {
    let data = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    }
    if (body) {
        data.body = JSON.stringify(body);
    }
    if (headers) {
        Object.keys(headers).forEach(key => {
            data.headers[key] = headers[key];
        });
    }
    return fetch(url, data)
        .then(res => res)
        .catch(error => console.error('Error:', error))
}

// Send transcript
function sendTranscript(conversation) {
    if (conversation && livePerson.conversationId !== '') {
        let url = livePerson.chatUrl + '/' + livePerson.conversationId + '/events?v=1&NC=true';
        let headers = {
            'Authorization': 'LivePerson appKey=' + livePerson.appKey
        };

        let transcriptText = 'Transcript:\n\n';
        let user = '';
        conversation.forEach(function(element) {
            user = element.user == 'guest' ? livePerson.visitorName : 'Bot';
            transcriptText += user + '): ' + (element.message.replace(/<\/?[^>]+(>|$)/g, "")) + '\r\n';
        });

        let body = {
            'event': {
                "@type": "line",
                "text": transcriptText 
            }
        };
        makeAPIRequest('POST', url, body, headers);
    }
}

// Set visitor name in LivePerson chat conversation
function setVisitorName(visitorName) {
    if (livePerson.conversationId !== '') {
        let url = livePerson.chatUrl + '/' + livePerson.conversationId + '/info/visitorName?v=1&NC=true';
        let headers = {
            'Authorization': 'LivePerson appKey=' + livePerson.appKey,
            'X-HTTP-Method-Override': 'PUT'
        };
        let body = { 'visitorName': visitorName };
        makeAPIRequest('POST', url, body, headers);
    }
}

//Prepare visitor information
function prepareInfoVisitor(data) {
    let firstname = (data.data.first_name)? data.data.first_name.value : 'Visitor';
    let lastname = (data.data.last_name) ? data.data.last_name.value : '';
    lpTag.sdes.push({
        "type": "personal",
            "personal": {
                "firstname": firstname, 
                "lastname": lastname,
                "contacts": [{
                    "email": (data.data.email_address) ? data.data.email_address.value : '',
                    "preferred": "EMAIL",
                }],
            "language": livePerson.language
        }
    });
    return firstname + (lastname !== '' ? ' ' + lastname : '');
}

//Catch the Chat Session ID
window.addEventListener("message", (event) => {
    if (event.origin.indexOf('liveperson.net') > 0 && event.data.indexOf('chatSessionKey') > 0 && livePerson.conversationId === '') {
        let data = JSON.parse(event.data);
        if (data) {
            let body = JSON.parse(data.body);
            if (body.chat !== undefined && body.chat.info !== undefined && body.chat.info.chatSessionKey !== undefined) {
                livePerson.conversationId = body.chat.info.chatSessionKey;
            }
        }
    }
}, false);

/*
 * Connects Inbenta's chatbot with LivePerson Agents
 */
var inbentaLivePersonAdapter = function() {
    return function(chatbot) {

        let buttonId = '';
        let conversation = null;
        let version = '1.0';
        let checkUrlService = 'https://api.liveperson.net/api/account/';
        checkUrlService += livePerson.account + '/service/conversationVep/baseURI?version=' + version;
        if (livePerson.chatUrl === '') {
            makeAPIRequest('GET', checkUrlService).then(function(data) {
                data.json().then(response => {
                    if (response.baseURI !== undefined && response.baseURI !== null) {
                        livePerson.chatUrl = 'https://' + response.baseURI + '/api/account/' + livePerson.account + '/chat';
                        localStorage.setItem('livePerson_chatUrl', livePerson.chatUrl);
                    }
                })
            });
        }

        //LivePerson chat states
        lpTag.events.bind('lpUnifiedWindow', 'state', function(data) {
            if (data.state === 'chatting') {
                //Sends the event to inbenta (chat_attended)
                chatbot.api.track('CHAT_ATTENDED', { value: true });
                setVisitorName(livePerson.visitorName);
                sendTranscript(conversation);
            }
            else if (data.state === 'ended') {
                //Close LivePerson chat window
                document.getElementsByClassName('lp_close')[0].click(); // TODO also this clases: lpc_maximized-header__close-button lpc_desktop
            }
            else if (data.state === 'offline') {
                //Show inbenta chatbot
                chatbot.actions.showConversationWindow();
            }
        });

        //Detects when LivePerson window is closed (and show Inbenta's Chatbot)
        lpTag.events.bind('lpUnifiedWindow', 'windowClosed', function() {
            //Window is closed
            chatbot.actions.displaySystemMessage({
                message: livePerson.labels.onEscalateEnds
            });
            chatbot.actions.showConversationWindow();
        });

        // Detects when LivePerson chat button is ready (hides it)
        lpTag.events.bind('LP_OFFERS', 'OFFER_DISPLAY', function(data) {
            //LivePerson is ready to start, hides the chat bubble
            livePerson.conversationId = '';
            let buttonTmp = document.getElementsByClassName('LPMcontainer')[0];
            buttonId = buttonTmp.getAttribute('id');
            buttonTmp.style.display = 'none';
        });

        // Escalate on Inbenta
        chatbot.subscriptions.onEscalateToAgent(function(data, next) {
            chatbot.actions.displaySystemMessage({
                message: livePerson.labels.onEscalate
            });

            chatbot.api.getVariables().then(function(data) {
                livePerson.visitorName = prepareInfoVisitor(data);
                conversation = chatbot.actions.getConversationTranscript();
                setTimeout(function() {
                    chatbot.actions.hideConversationWindow();
                    document.getElementById(buttonId).click();
                }, 400);
            });
        });

    } // return chatbot
} // export default