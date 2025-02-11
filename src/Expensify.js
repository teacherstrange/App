import _ from 'underscore';
import lodashGet from 'lodash/get';
import PropTypes from 'prop-types';
import React, {PureComponent} from 'react';
import {AppState} from 'react-native';
import Onyx, {withOnyx} from 'react-native-onyx';

import BootSplash from './libs/BootSplash';
import * as ActiveClientManager from './libs/ActiveClientManager';
import ONYXKEYS from './ONYXKEYS';
import NavigationRoot from './libs/Navigation/NavigationRoot';
import migrateOnyx from './libs/migrateOnyx';
import PushNotification from './libs/Notification/PushNotification';
import UpdateAppModal from './components/UpdateAppModal';
import Visibility from './libs/Visibility';
import GrowlNotification from './components/GrowlNotification';
import * as Growl from './libs/Growl';
import StartupTimer from './libs/StartupTimer';
import Log from './libs/Log';
import ConfirmModal from './components/ConfirmModal';
import compose from './libs/compose';
import withLocalize, {withLocalizePropTypes} from './components/withLocalize';
import * as User from './libs/actions/User';
import NetworkConnection from './libs/NetworkConnection';

Onyx.registerLogger(({level, message}) => {
    if (level === 'alert') {
        Log.alert(message);
        console.error(message);
    } else {
        Log.info(message);
    }
});

const propTypes = {
    /* Onyx Props */

    /** Session info for the currently logged in user. */
    session: PropTypes.shape({

        /** Currently logged in user authToken */
        authToken: PropTypes.string,

        /** Currently logged in user accountID */
        accountID: PropTypes.number,
    }),

    /** Whether a new update is available and ready to install. */
    updateAvailable: PropTypes.bool,

    /** Tells us if the sidebar has rendered */
    isSidebarLoaded: PropTypes.bool,

    /** Information about a screen share call requested by a GuidesPlus agent */
    screenShareRequest: PropTypes.shape({

        /** Access token required to join a screen share room, generated by the backend */
        accessToken: PropTypes.string,

        /** Name of the screen share room to join */
        roomName: PropTypes.string,
    }),

    ...withLocalizePropTypes,
};

const defaultProps = {
    session: {
        authToken: null,
        accountID: null,
    },
    updateAvailable: false,
    isSidebarLoaded: false,
    screenShareRequest: null,
};

class Expensify extends PureComponent {
    constructor(props) {
        super(props);

        // Initialize this client as being an active client
        ActiveClientManager.init();
        this.setNavigationReady = this.setNavigationReady.bind(this);
        this.initializeClient = this.initializeClient.bind(true);
        this.appStateChangeListener = null;
        this.state = {
            isNavigationReady: false,
            isOnyxMigrated: false,
            isSplashShown: true,
        };

        // Used for the offline indicator appearing when someone is offline
        NetworkConnection.subscribeToNetInfo();
    }

    componentDidMount() {
        setTimeout(() => this.reportBootSplashStatus(), 30 * 1000);

        // This timer is set in the native layer when launching the app and we stop it here so we can measure how long
        // it took for the main app itself to load.
        StartupTimer.stop();

        // Run any Onyx schema migrations and then continue loading the main app
        migrateOnyx()
            .then(() => {
                // In case of a crash that led to disconnection, we want to remove all the push notifications.
                if (!this.isAuthenticated()) {
                    PushNotification.clearNotifications();
                }

                this.setState({isOnyxMigrated: true});
            });

        this.appStateChangeListener = AppState.addEventListener('change', this.initializeClient);
    }

    componentDidUpdate(prevProps) {
        const previousAccountID = lodashGet(prevProps, 'session.accountID', null);
        const currentAccountID = lodashGet(this.props, 'session.accountID', null);

        if (currentAccountID && (currentAccountID !== previousAccountID)) {
            PushNotification.register(currentAccountID);
        }

        if (this.state.isNavigationReady && this.state.isSplashShown) {
            const shouldHideSplash = !this.isAuthenticated() || this.props.isSidebarLoaded;

            if (shouldHideSplash) {
                BootSplash.hide();

                // eslint-disable-next-line react/no-did-update-set-state
                this.setState({isSplashShown: false});
            }
        }
    }

    componentWillUnmount() {
        if (!this.appStateChangeListener) { return; }
        this.appStateChangeListener.remove();
    }

    setNavigationReady() {
        this.setState({isNavigationReady: true});
    }

    /**
     * @returns {boolean}
     */
    isAuthenticated() {
        const authToken = lodashGet(this.props, 'session.authToken', null);
        return Boolean(authToken);
    }

    initializeClient() {
        if (!Visibility.isVisible()) {
            return;
        }

        ActiveClientManager.init();
    }

    reportBootSplashStatus() {
        BootSplash
            .getVisibilityStatus()
            .then((status) => {
                const appState = AppState.currentState;
                Log.info('[BootSplash] splash screen status', false, {appState, status});

                if (status === 'visible') {
                    const props = _.omit(this.props, ['children', 'session']);
                    props.isAuthenticated = this.isAuthenticated();
                    Log.alert('[BootSplash] splash screen is still visible', {props}, false);
                }
            });
    }

    render() {
        // Display a blank page until the onyx migration completes
        if (!this.state.isOnyxMigrated) {
            return null;
        }

        return (
            <>
                {!this.state.isSplashShown && (
                    <>
                        <GrowlNotification ref={Growl.growlRef} />
                        {/* We include the modal for showing a new update at the top level so the option is always present. */}
                        {this.props.updateAvailable ? <UpdateAppModal /> : null}
                        {this.props.screenShareRequest ? (
                            <ConfirmModal
                                title={this.props.translate('guides.screenShare')}
                                onConfirm={() => User.joinScreenShare(this.props.screenShareRequest.accessToken, this.props.screenShareRequest.roomName)}
                                onCancel={User.clearScreenShareRequest}
                                prompt={this.props.translate('guides.screenShareRequest')}
                                confirmText={this.props.translate('common.join')}
                                cancelText={this.props.translate('common.decline')}
                                isVisible
                            />
                        ) : null}
                    </>
                )}

                <NavigationRoot
                    onReady={this.setNavigationReady}
                    authenticated={this.isAuthenticated()}
                />
            </>
        );
    }
}

Expensify.propTypes = propTypes;
Expensify.defaultProps = defaultProps;
export default compose(
    withLocalize,
    withOnyx({
        session: {
            key: ONYXKEYS.SESSION,
        },
        updateAvailable: {
            key: ONYXKEYS.UPDATE_AVAILABLE,
            initWithStoredValues: false,
        },
        isSidebarLoaded: {
            key: ONYXKEYS.IS_SIDEBAR_LOADED,
        },
        screenShareRequest: {
            key: ONYXKEYS.SCREEN_SHARE_REQUEST,
        },
    }),
)(Expensify);
