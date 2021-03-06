import SpotifyWebApi from 'spotify-web-api-js';

const spotifyApi = new SpotifyWebApi();
const maxSeeds = 5;

/* Note this class does not catch any exceptions so caller must catch any of the thrown exceptions */
class RecommendationsService {
    constructor(options) {
        this.options = options;
        this.playListId = null;
    }

    /*
    * Uses user options to get their recommended tracks with properties in a given time range,
    * how large the playlist will be, how many seeds to use, and what kind of seeds and creates a 
    * Spotify playlist from recommended tracks
    */
   async getRecommendedTracksAndCreatePlaylist() {
        await spotifyApi.setAccessToken(this.options.access_token);

        let usersTopIds = await this.getUsersTopIds();
        let recommendedTracks = [];

        if (usersTopIds.seed_artists && usersTopIds.seed_artists.length > 0) {
            const recommendedTracksFromCall = await this.getRecommendedTracks(
                usersTopIds.seed_artists, 'seed_artists');
            recommendedTracks = recommendedTracks.concat(recommendedTracksFromCall);
        }

        if (usersTopIds.seed_tracks && usersTopIds.seed_tracks.length > 0) {
            const recommendedTracksFromCall = await this.getRecommendedTracks(
                usersTopIds.seed_tracks, 'seed_tracks');
            recommendedTracks = recommendedTracks.concat(recommendedTracksFromCall);
        }

        const recommendedPlaylist = await this.createPlaylist(recommendedTracks);
        return {
            recommendedList: recommendedPlaylist,
            playListId: this.playListId
        }
    } 
    
    /*
    * Gets the top ids for a given seed from user options, which can be either only artists, 
    * split between artists and tracks, and only tracks and at a user selected time range
    * @returns {Object}, an object with key-value pairing representing seedType and Spotify Ids of the
    * top user preferences in that seedType
    */
   async getUsersTopIds() {  
    let userTopIds;  
    let topArtists;
    let topTracks;
    
    if (this.options.options.recommendationsMethod === 'onlyArtist') {
        topArtists = await spotifyApi.getMyTopArtists({
            limit: this.options.options.useTopTracks, 
            time_range: this.options.options.timeRange
        });
        userTopIds = {seed_artists: topArtists.items.map(artist => artist.id)};
    } 
    
    else if (this.options.options.recommendationsMethod === 'split') {
        const topTracksLen = Math.ceil(this.options.options.useTopTracks / 2);
        const topArtistsLen = this.options.options.useTopTracks - topTracksLen;

        topTracks = await spotifyApi.getMyTopTracks({
            limit: topTracksLen,
            time_range: this.options.options.timeRange
        });

        userTopIds = {seed_tracks: topTracks.items.map(song => song.id)};
        if (topArtistsLen > 0) {
            topArtists = await spotifyApi.getMyTopArtists({
                limit: topArtistsLen,
                time_range: this.options.options.timeRange
            });
            userTopIds = {
                ...userTopIds, 
                ...{seed_artists: topArtists.items.map(artist => artist.id)}};
        }
    } 
    
    else {
        topTracks = await spotifyApi.getMyTopTracks({
            limit: this.options.options.useTopTracks,
            time_range: this.options.options.timeRange
        });
        userTopIds = {seed_tracks: topTracks.items.map(track => track.id)};
    } 

    return userTopIds;
}

    /*
    * Returns the user's recommended Spotify tracks based on user's seedOption and using userTopIds as seeds 
    * @param {number[]} userTopIds, an array of Spotify Ids representing user's tops in the seedOption
    * @param {string} seedOption, a String refering to either "seed_tracks" or "seed_artists"
    * @returns {SpotifyTrackObject[]} recommended tracks for this user
    */
    async getRecommendedTracks(userTopIds, seedOption) {
        let numTracksToCreate = this.options.options.playListLength;

        if (this.options.options.recommendationsMethod === 'split') {
            if (seedOption === 'seed_tracks') {
                numTracksToCreate = Math.ceil(this.options.options.playListLength/2);
            } else if (seedOption === 'seed_artists') {
                numTracksToCreate = Math.floor(this.options.options.playListLength/2);
            }
        }
        
        if (userTopIds.length < maxSeeds) {
            const recommendedTracks = await spotifyApi.getRecommendations({
                limit: numTracksToCreate,
                [seedOption]: userTopIds
            })
            return recommendedTracks.tracks;
        }

        let seedsRemaining = userTopIds.length;
        let recommendedTracks = [];

        let numTracksRemaining = numTracksToCreate;
        for (let i = 0; seedsRemaining > 0 && numTracksRemaining > 0; i++) {
            let seedsToUse, numTracksPortion;
            
            if (seedsRemaining >= maxSeeds) {
                numTracksPortion = Math.round(numTracksToCreate / Math.floor(userTopIds.length / maxSeeds));
                seedsToUse = maxSeeds;
            } else {
                numTracksPortion = numTracksRemaining;
                seedsToUse = seedsRemaining;
            }

            const userTopIdsPortion = userTopIds.slice(i * seedsToUse, (i + 1) * seedsToUse - 1);
            const recommendedTracksPortion = await spotifyApi.getRecommendations({
                limit: numTracksPortion,
                [seedOption]: userTopIdsPortion 
            })
            recommendedTracks = recommendedTracks.concat(recommendedTracksPortion.tracks);
            seedsRemaining -= maxSeeds;
            numTracksRemaining -= numTracksPortion;
        }
        return recommendedTracks;
    }

    /*
    * Creates a Spotify playlist based on recommendedTracks and appends an array of SpotifyTrackObjects
    * to each recommended track representing the artist's top songs
    * @param {SpotifyTrackObject[]} recommendedTracks, an array of Spotify tracks objects 
    * representing a user's recommended tracks
    */
    async createPlaylist(recommendedTracks) {
        if (recommendedTracks.length > 0) {
            const recommendedListSongs = recommendedTracks.map(song => 'spotify:track:' + song.id);
            const userId = await spotifyApi.getMe();

            const recommendedPlaylist = await spotifyApi.createPlaylist(userId.id, 
                {name: "Your Top Recommendations", 
                description: "A playlist of recommended songs made with Find Vibes", public: false});
        
            await spotifyApi.addTracksToPlaylist(recommendedPlaylist.id, recommendedListSongs);       
            this.playListId = recommendedPlaylist.id;

            let recommendedTracksWithArtistTop = await recommendedTracks.map(
                (track) => this.addTopTracks(track, userId.country));
            // used to resolve promise array returned by mapping each track to a promise in async call
            recommendedTracksWithArtistTop = await Promise.all(recommendedTracksWithArtistTop);

            return recommendedTracksWithArtistTop;
        } else {
            throw new Error({status: 20});
        }
    }

    /*
    * Adds song to playlist based on this
    * @param {songId}, a spotify id for a song 
    * @param {callback}, a callback function for the caller
    */
    async addToPlayList(songId) {
        spotifyApi.addTracksToPlaylist(this.playListId, 
            ['spotify:track:' + songId], {position: 0});
    }

    /*
    * Removes song from this spotify playlist
    * @param {songId}, a spotify id for a song 
    */
    async removeFromPlayList(songId) {
        spotifyApi.removeTracksFromPlaylist(this.playListId, 
            ['spotify:track:' + songId]);
    }

    /*
    * Creates playlist based on list of recommended songs 
    * @param {Object}, a track object containing basic song details such as uri, name, and artists
    * @param {string}, a country code representing the user's country
    * @returns {promise}, a promise track object with artist's top tracks added
    */
    async addTopTracks(track, country) {
        const topTracks = await spotifyApi.getArtistTopTracks(track.artists[0].id, country);
        track['topTracks'] = topTracks;
        return track;
    }
}

export default RecommendationsService;