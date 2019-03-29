/*
  - Copyright (c) 2014-2016 Cloudware S.A. All rights reserved.
  -
  - This file is part of casper-login.
  -
  - casper-login is free software: you can redistribute it and/or modify
  - it under the terms of the GNU Affero General Public License as published by
  - the Free Software Foundation, either version 3 of the License, or
  - (at your option) any later version.
  -
  - casper-login  is distributed in the hope that it will be useful,
  - but WITHOUT ANY WARRANTY; without even the implied warranty of
  - MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  - GNU General Public License for more details.
  -
  - You should have received a copy of the GNU Affero General Public License
  - along with casper-login.  If not, see <http://www.gnu.org/licenses/>.
  -
 */

import '@polymer/iron-icons/iron-icons.js';
import '@polymer/paper-input/paper-input.js';
import '@polymer/paper-toast/paper-toast.js';
import '@polymer/paper-checkbox/paper-checkbox.js';
import '@casper2020/casper-icons/casper-icons.js';
import '@casper2020/casper-button/casper-button.js';
import '@casper2020/casper-socket/casper-socket.js';
import { PolymerElement, html } from '@polymer/polymer/polymer-element.js';

export class CasperLogin extends PolymerElement {
  static get template() {
    return html`
      <style>
        :host {
          display: block;
          tabindex: -1;
          margin-bottom: 20px;
        }

        paper-input, paper-checkbox {
          display: block;
        }

        paper-checkbox {
          margin-top: 12px;
        }

        paper-input {
          width: 100%;
        }

        #spin {
          width: 16px;
          height: 16px;
          display: none;
          padding-right: 6px;
          --paper-spinner-color: #ccc;
        }

        #spin[active] {
          display: inline-flex;
        }

        casper-button{
          margin-right: 0;
        }

        #signIn {
          /* background-color: #101010; */
        }

         #signIn a {
          color: #ffffff;
        }

        #toast {
          --paper-toast-background-color: #f12424;
          --paper-toast-color: white;
          width: 100%;
          font-weight: bold;
          display: inline-flex;
          justify-content: space-between;
          align-items: center;
        }

        #toast[success]{
          --paper-toast-background-color: #4a9a4a;
          --paper-toast-color: white;
        }

        .user_actions a {
          text-align: center;
          color: var(--primary-color);
          text-decoration: none;
          display: none;
        }

        .user_actions a:hover {
          text-decoration: underline;
        }

        #forget_button {
          visibility: hidden;
        }

        .buttons {
          margin-top: 16px;
        }

        .buttons #signIn {
          display: none;
        }

        .buttons #forgetPasswordJob {
          display: none;
        }

        .user_actions[disabled] a {
          pointer-events: none;
          cursor: default;
          opacity: 0.6;
          color: grey;
        }

      </style>
        <casper-socket id="socket" tube-prefix="[[tubePrefix]]" cookie-domain="[[cookieDomain]]"></casper-socket>

        <paper-input id="email" name="email" label="Correio eletrónico" tabindex="1" auto-validate="" autocomplete="email" minlength="4" autofocus=""></paper-input>
        <paper-input id="password" name="password" label="Senha" type="password" tabindex="2" auto-validate="" autocomplete="password" minlength="6"></paper-input>
        <paper-checkbox id="remember" tabindex="4" checked="{{remember}}">Gravar dados de entrada</paper-checkbox>

        <div class="buttons">
          <casper-button id="signIn" tabindex="5" on-tap="_signIn">
            <a>Entrar</a>
          </casper-button>

          <casper-button id="forgetPasswordJob" tabindex="5" on-tap="_forgetPasswordJob">
            <a>Enviar-me instruções para recuperação da senha</a>
          </casper-button>
        </div>

        <div id="userAction" class="user_actions">
          <a id="forget_form" href="#" on-tap="_forgotPassword" tabindex="-1">Esqueceu-se da sua senha?</a>
          <a id="login_form" href="#" on-tap="_signInForm" tabindex="-1">Preencher dados de login.</a>
        </div>

      <paper-toast id="toast" duration="5000">
        <iron-icon id="closeToast" on-tap="_hideToast" icon="casper-icons:cancel"></iron-icon>
      </paper-toast>
    `;
  }

  static get is () {
    return 'casper-login';
  }

  static get properties () {
    return {
      /** How long should we wait for the server to respond */
      timeout: {
        type: Number,
        value: 10
      },
      /** Prefix for the beanstalk tube names */
      tubePrefix: {
        type: String,
        value: 'casper'
      },
      /** Domain used by the cookie, important when using a cluster */
      cookieDomain: {
        type: String,
        value: undefined
      },
      /** Other HTML element where tooltip/toast fits into */
      tooltipFitInto: {
        type: Object,
        observer: '_tooltipFitInto'
      },
      /** true when using saved credentials or the user want's to save them */
      remember: {
        type: Boolean,
        value: false,
        observer: '_rememberChanged'
      },
      /** disable automatic loging */
      noAutoLogin: {
        type: Boolean,
        value: false
      }
    }
  }

  ready () {
    super.ready();
    this.$.email.addEventListener('keydown', e => this._onKeyDown(e));
    this.$.password.addEventListener('keydown', e => this._onKeyDown(e));
    this.$.password.addEventListener('focused-changed', e => this._onFocusChange(e));
    this.$.toast.fitInto = this;
    this._autoLogin = undefined;
    this._resetValidation();
    this._showLogin();
  }

  connectedCallback () {
    super.connectedCallback();

    if ( CasperLogin.redirectToIssuer(this.$.socket.issuerUrl) === false ) {
      if ( this.noAutoLogin !== true ) {
        this._attemptAutomaticLogin();
      }
    }
  }

  disconnectedCallback () {
    super.disconnectedCallback();
    this.$.socket.disconnect();
  }

  overrideAutomaticLogin (email, message) {
    this.$.signIn.disabled = true;
    this.$.signIn.submitting(true);
    this.$.email.value = email;
    this.$.password.value = '\xA0\xA0\xA0\xA0\xA0\xA0\xA0\xA0';
    this._lockUi();
    this._openToast(message, true);
  }

  showErrorAndCleanup (message) {
    this._showError(message);
    this.$.email.value = '';
    this.$.password.value = '';
  }

  /**
   * Attempt login with stored refresh token or using current access token stored in cookie
   */
  _attemptAutomaticLogin () {
    let email         = this.$.socket.savedEmail;
    let refresh_token = this.$.socket.savedCredential;
    let access_token  = this.$.socket.sessionCookie;
    if ( (email && refresh_token) || access_token ) {
      this.$.signIn.disabled = true;
      this.$.signIn.submitting(true);
      this._lockUi();
      if ( email && refresh_token ) {
        this.$.email.value = email;
        this.$.password.value = '\xA0\xA0\xA0\xA0\xA0\xA0\xA0\xA0';
        this.remember = true;
        this._openToast('Inicio de sessão automático com credencial gravada', true);
      } else {
        this._openToast('Renovação de sessão iniciada', true);
      }
      this.$.socket.submitJob({
          tube:          this.$.socket.refreshTube,
          refresh_token: refresh_token,
          access_token:  access_token,
          last_entity_id: window.localStorage.getItem('casper-last-entity-id')
        },
        this._signInResponse.bind(this), {
          ttr: Math.max(this.timeout - 5, 5),
          validity: this.timeout,
          timeout: this.timeout
        }
      );
      this._autoLogin = true;
      return true;
    } else {
      this._autoLogin = false;
      return false;
    }
  }

  /**
   * Event handler for sign-in button, attemps auto login first, if its not possible then performs normal login
   */
  _signIn (event) {

    // ... attempt automatic login 1st ...
    if ( this._attemptAutomaticLogin() === true ) {
      return;  // ... auto login kicked in return now ...
    }

    // ... inputs validation ...
    if ( this.$.email.invalid || this.$.email.value === undefined || this.$.email.value.length === 0 ) {
      this.$.email.invalid = true;
      this.$.email.focus();
      this.$.signIn.submitting(false);
      return;
    }
    if ( this.$.password.invalid || this.$.password.value === undefined || this.$.password.value.length === 0 ) {
      this.$.password.invalid = true;
      this.$.password.focus();
      this.$.signIn.submitting(false);
      return;
    }

    // ... block UI until server responds ...
    this._lockUi();
    this._hideToast();
    this.$.signIn.submitting(true);

    // ... submit login request to the login tube ...
    this.$.socket.submitJob({
        tube:     this.$.socket.loginTube,
        email:    this.$.email.value,
        password: btoa(encodeURIComponent(this.$.password.value)),
        remember: this.remember,
        last_entity_id: window.localStorage.getItem('casper-last-entity-id')
      },
      this._signInResponse.bind(this), {
        ttr: Math.max(this.timeout - 5, 5),
        validity: this.timeout,
        timeout: this.timeout
      }
    );
  }

  _signInResponse (notification) {
    switch (notification.status_code ) {
      case 200:
        if ( notification.status && notification.response ) {
          this._lockUi();
          this.$.socket.loginListener(notification);
        }
        break;
      case 401:
        if ( this._autoLogin === true ) {
          this._showError('Credencial expirada, re-introduza email e senha');
          this.$.socket.wipeCredentials();
          this.$.password.value = '';
          this.$.email.$.nativeInput.select();
          this.$.toast.setAttribute('success', '');
        } else {
          this._showPasswordError();
        }
        break;
      case 504:
        this._showError('Tempo máximo de espera ultrapassado, p.f. tente mais tarde.');
        break;
      case 500:
      default:
        this._showError('Serviço Indisponível, p.f. tente mais tarde.');
        break;
    }
  }

  _showLogin () {
    this.$.signIn.style.display = 'block';
    this.$.forget_form.style.display = 'block';

    this.$.password.style.display = 'block';
    this.$.remember.style.display = 'block';

    // show/hide links
    this.$.forgetPasswordJob.style.display = 'none';
    this.$.login_form.style.display = 'none';
  }

  _showForgetPassword () {
    this.$.forgetPasswordJob.style.display = 'block';
    this.$.login_form.style.display = 'block';

    this.$.password.style.display = 'none';
    this.$.remember.style.display = 'none';

    // show/hide links
    this.$.signIn.style.display = 'none';
    this.$.forget_form.style.display = 'none';
  }

  _forgotPassword (event) {
    this._showForgetPassword()
    event.preventDefault();
  }

  _signInForm (event) {
    this._showLogin();
    event.preventDefault();
  }

  _forgetPasswordJob (event) {
    if ( this.$.email.invalid || this.$.email.value === undefined || this.$.email.value.length === 0 ) {
      this.$.email.invalid = true;
      this.$.email.focus();
      this.$.signIn.submitting(false);
      return;
    } else {
      this._lockUi();
      this.$.socket.submitJob({
          tube: this.$.socket.tubePrefix + '-recover-password',
          email: this.$.email.value
        },
        this._forgetPasswordResponse.bind(this), {
          ttr: Math.max(this.timeout - 5, 5),
          validity: this.timeout,
          timeout: this.timeout
        }
      );
    }
    event.preventDefault();
  }

  _forgetPasswordResponse (notification) {
    if ( notification.status === 'completed' ) {
      var response = notification.response;
      this.$.forgetPasswordJob.progress = 100;
      this.$.forgetPasswordJob.submitting(false);
      this._unlockUi();

      if ( response.success == false ) {
        this._showError('Email não encontrado.');
      } else {
        this._showSuccess('Instruções enviadas por email.');
        this._showLogin();
      }
    }else {
      this._showError('Erro na operação');
    }
  }

  _openToast (message, success) {
    if ( success !== undefined ) {
      if ( success ) {
        this.$.toast.setAttribute('success', '');
      } else {
        this.$.toast.removeAttribute('success');
      }
    }
    this.$.toast.text = message;
    this.$.toast.open();
  }

  _showSuccess (message) {
    this.$.toast.setAttribute('success', '');
    this._openToast(message);
    this._unlockUi();
  }

  _showError (message) {
    this.$.toast.removeAttribute('success');
    this.$.email.invalid = false;
    this.$.password.invalid = false;
    this._openToast(message);
    this._unlockUi();
  }

  _showInputError (message) {
    this._hideToast();
    this.$.email.errorMessage = message;
    this.$.password.errorMessage = '';
    this.$.email.invalid = true;
    this.$.password.invalid = true;
    this._unlockUi();
  }

  _showPasswordError () {
    this._showError('Senha ou email errados');
    this.$.password.errorMessage = 'Senha ou email errados';
    this.$.password.invalid = true;
    this.$.email.$.nativeInput.select();
    this.$.password.$.nativeInput.select();
  }

  _lockUi () {
    this._hideToast();
    this.$.email.disabled = true;
    this.$.password.disabled = true;
    this.$.remember.disabled = true;
    this.$.userAction.setAttribute('disabled', '');
  }

  _unlockUi () {
    clearTimeout(this._signInTimer);
    this._signInTimer = undefined;
    this.$.email.disabled = false;
    this.$.password.disabled = false;
    this.$.remember.disabled = false;
    this.$.socket.disconnect();
    this.$.signIn.submitting(false);
    this.$.userAction.removeAttribute('disabled');
  }

  _hideToast () {
    this.$.toast.close();
  }

  _onKeyDown (event) {
    if ( event.keyCode === 13 ) {
      if ( this.$.password.focused ) {
        this._signIn();
      } else if ( this.$.email.focused ) {
        this.$.password.focus();
      }
    } else {
      this._hideToast();
      this._resetValidation();
    }
  }

  _resetValidation () {
    this.$.email.invalid = false;
    this.$.password.invalid = false;
    this.$.email.errorMessage = 'Email demasiado curto';
    this.$.password.errorMessage = 'Senha demasiado curta';
  }

  /**
   * Focus listener for password field
   *
   * After the login error password is focused, when the focus moves out hide the tooltip
   */
  _onFocusChange (event) {
    if ( event.detail.value == false && event.target.id === 'password') {
      this._hideToast();
    }
  }

  /**
   * A transition to false on the remember checkbox clears saved credentials but only after _autoLogin was defined
   *
   * @param value current value of the checkbox element
   */
  _rememberChanged (value) {
    if ( value === false && this._autoLogin !== undefined && this.$.socket.savedCredential ) {
      this.$.socket.wipeCredentials();
      this.$.password.value = '';
      this.$.email.$.nativeInput.select();
      this.$.toast.setAttribute('success', '');
      this._openToast('A credencial gravada foi eliminada, entre email e senha novamente', true);
    }
  }

  /**
   * Property change observer to adjust the tooltip fit into behaviour
   *
   * @param {object} value the HTML element that contains the tooltip
   */
  _tooltipFitInto (value) {
    if ( this.$ && this.$.toast ) {
      this.$.toast.fitInto = value;
    }
  }

  /**
   * Checks if redirection is needed
   *
   * @param {string} issuer URL of the server that issued the credential
   * @return true redirect to issuer, false stay on the current server
   */
  static redirectToIssuer (issuer) {
    if ( issuer === undefined ) {
      return false; // issuer is unknown no need to redirect
    }
    if ( issuer === window.location.origin ) {
      return false; // No need to redirect same url
    } else {
      let m1 = /http[s]*:\/\/([a-zA-Z]+)(\d)?\.(\w.+)/.exec(issuer);
      let m2 = /http[s]*:\/\/([a-zA-Z]+)(\d)?\.(\w.+)/.exec(window.location.origin);

      // Redirect ONLY if subdomain is the same excluding the cluster number and domain/port is the same
      if ( m1 && m2 && m1.length === 4 && m2.length === 4 && m1[1] == m2[1] && m1[3] === m2[3]) {
        let redirect = window.location.href.replace(window.location.origin, issuer);
        console.warn('redirecting to the server that issued the credential => '+redirect);
        window.location = redirect;
        return true; // ** not reached ** Sister URLs do a redirect
      } else {
        return false; // unrelated URLs don't redirect
      }
    }
  }
}

window.customElements.define(CasperLogin.is, CasperLogin);