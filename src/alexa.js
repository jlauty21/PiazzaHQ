'use strict';
// Voice control, Alexa skill: mounted when the Alexa SDK packages are installed (Amazon's signature is the authentication), otherwise a 503.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/alexa-smoke.test.js.
module.exports = function registerAlexa({ Alexa, ExpressAdapter, app, addVoiceItem }) {
  // Same underlying addVoiceItem() as the Siri route above, but Alexa doesn't
  // send a bearer token — its own request comes with a cryptographic signature
  // (an X.509 cert chain + timestamp) that ask-sdk-express-adapter verifies
  // automatically, which is why this is authenticated a third, different way
  // from the previous two routes. Deliberately using the official SDK for this
  // rather than hand-rolling signature verification: getting that subtly wrong
  // (a cert-chain check that looks right but doesn't actually validate against
  // Amazon's real CA) would be worse than not having it, and is exactly the
  // kind of security code that shouldn't be reinvented per-project.
  // ALEXA_SKILL_ID (from .env) must match the skill's real ID once created in
  // the Alexa Developer Console — without it, requestInterceptors below still
  // verifies the signature/timestamp, but skips confirming the request is
  // actually FOR this skill specifically (which matters if this same public
  // endpoint is ever guessed at by an unrelated skill's requests).
  const ALEXA_SKILL_ID = process.env.ALEXA_SKILL_ID || '';
  if (Alexa && ExpressAdapter) {
    const AddItemIntentHandler = {
      canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
          && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddItemIntent';
      },
      handle(handlerInput) {
        const slots = handlerInput.requestEnvelope.request.intent.slots || {};
        const itemName = slots.ItemName && slots.ItemName.value;
        const listName = (slots.ListName && slots.ListName.value) || 'shopping';
        if (!itemName) {
          return handlerInput.responseBuilder.speak("What should I add?").reprompt("What should I add?").getResponse();
        }
        const result = addVoiceItem(itemName, listName);
        const speech = result.error
          ? `Sorry, I couldn't do that — ${result.error}`
          : `Added ${itemName} to your ${result.list === 'shopping' ? 'shopping list' : result.list + ' list'}.`;
        return handlerInput.responseBuilder.speak(speech).getResponse();
      },
    };
    const LaunchRequestHandler = {
      canHandle(handlerInput) { return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest'; },
      handle(handlerInput) {
        return handlerInput.responseBuilder.speak("You can say, add milk to the shopping list.").reprompt("What should I add?").getResponse();
      },
    };
    const HelpIntentHandler = {
      canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
          && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
      },
      handle(handlerInput) {
        return handlerInput.responseBuilder.speak("Say something like, add milk to the shopping list.").reprompt("What should I add?").getResponse();
      },
    };
    const CancelAndStopIntentHandler = {
      canHandle(handlerInput) {
        const name = Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(handlerInput.requestEnvelope);
        return name === 'AMAZON.CancelIntent' || name === 'AMAZON.StopIntent';
      },
      handle(handlerInput) { return handlerInput.responseBuilder.speak("Okay.").getResponse(); },
    };
    const SessionEndedRequestHandler = {
      canHandle(handlerInput) { return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest'; },
      handle(handlerInput) { return handlerInput.responseBuilder.getResponse(); },
    };
    const ErrorHandler = {
      canHandle() { return true; },
      handle(handlerInput, error) {
        console.error('Alexa skill error:', error && error.message);
        return handlerInput.responseBuilder.speak("Sorry, something went wrong.").getResponse();
      },
    };
    const skillBuilder = Alexa.SkillBuilders.custom()
      .addRequestHandlers(AddItemIntentHandler, LaunchRequestHandler, HelpIntentHandler, CancelAndStopIntentHandler, SessionEndedRequestHandler)
      .addErrorHandlers(ErrorHandler);
    if (ALEXA_SKILL_ID) skillBuilder.withSkillId(ALEXA_SKILL_ID);
    const alexaAdapter = new ExpressAdapter(skillBuilder.create(), true, true); // (skill, verifySignature, verifyTimestamp) — both left on
    // Mounted directly, not behind requireAuth: Alexa's own signature already
    // IS the authentication here, and requireAuth's PIN-session model has no
    // way to authenticate an Alexa request in the first place (no cookie, no
    // bearer token, no interactive login possible).
    app.post('/api/alexa', alexaAdapter.getRequestHandlers());
  } else {
    app.post('/api/alexa', (req, res) => res.status(503).json({ error: 'Alexa integration isn\'t installed on this server — run npm install and restart.' }));
  }
};
