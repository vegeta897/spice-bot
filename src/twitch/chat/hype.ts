export function getCurrentHypeTrain(): false {
	// TODO
	return false
}

// TODO: Only add contribution property if bits >= 100

/*

Twitch API docs are not very clear about how subs work in hype trains

https://dev.twitch.tv/docs/eventsub/eventsub-reference/#last-contribution
This says that if the contribution type is subscription, 
the total will be 500, 1000, or 2500, representing tier 1, 2, or 3 subs.
Does that mean there will be one event per sub?
And in the one of the example payloads, it shows a total of 45 for a sub type

So until I have real world data, I'm going to code defensively.

If the total is less than 500, then it's simply the number of subs (doubtful)
If the total is 500 or more, I'm going to divide by 500 to get the number of subs
(It's unlikely that anyone is going to do higher tier subs anyway)

HANG ON

https://twitch.uservoice.com/forums/310213-developers/suggestions/42201181-provide-the-amount-the-hype-train-progress-increas
So, great, now I'm not even sure if tracking all the last_contribution objects
will give me everything. Unfortunately I have nothing else to rely on here, because
I need this to separate bits from subs, and to get the user color. Oh well, maybe
this issue is out of date and they've fixed it since

And then I found...
https://github.com/plusmnt/twitch-train-led/blob/master/hype_train_sample.json
This is old, but it looks like real-world data
Based on lines 1-208 & 342-424, it does send one event per sub,
with the same timestamp, and the train total includes the value of
all the subs for that batch

*/
